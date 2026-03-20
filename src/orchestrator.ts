import { errMsg } from "../shared/format";
import { log } from "./utils";
import { initLogLevel } from "./infra/logger";
import { loadPairConfigs, pairToConfigEntry } from "./config/pairs";
import {
  loadStrategyConfigs,
  strategyToConfigEntry,
  configEntryToStrategy,
} from "./config/strategies";
import type { WorkerType } from "./worker-base";
import {
  ORCHESTRATOR_LOCK_TTL,
  HEALTH_CHECK_INTERVAL,
  HEARTBEAT_TIMEOUT,
  SHUTDOWN_GRACE_MS,
  MAX_RESPAWN_BACKOFF_MS,
  MAX_FAIL_COUNT,
  COLLECTOR_STARTUP_DELAY_MS,
  SUBSCRIBER_RECONNECT_MS,
} from "./config/params";
import {
  createRedis,
  KEYS,
  CHANNELS,
  acquireLock,
  refreshLock,
  releaseLock,
  getWorkerState,
  getCollectorState,
  publishControl,
  pairCfg,
  strategyCfg,
  dexCfg,
  getConfigCollectorPairIds,
  addConfigCollectorPair,
  getConfigPools,
  setConfigPools,
  getRpcConfig,
} from "./infra/redis";
import type { DexMetadata } from "../shared/types";
import { DEX_DISPLAY_NAMES } from "./config/dexs";
import { POOL_REGISTRY } from "./config/pools";
import { loadRpcOverrides, setChainRpcs } from "./config/chains";
import { invalidateClients } from "./execution/tx";
import { DragonflyStore } from "./data/store-dragonfly";
import {
  createWorkerContainer,
  startContainer,
  stopContainer,
  killContainer,
  inspectContainer,
  cleanupStaleContainers,
  type DockerConfig,
} from "./infra/docker";
import { resolveOciRuntime, ensureRuntimeReady } from "./infra/oci";
import type { Subprocess } from "bun";

initLogLevel();

const startTs = Date.now();
const lockValue = `orchestrator:${process.pid}:${startTs}`;

// ---- Worker Backend Abstraction ----

type WorkerRef = { kind: "process"; proc: Subprocess } | { kind: "docker"; containerId: string };

interface WorkerHandle {
  id: string; // strategy name for strategies, pairId for collectors
  workerType: WorkerType;
  ref: WorkerRef;
  spawnedAt: number;
  failCount: number;
  nextRetryAt: number;
}

interface WorkerBackend {
  mode: "process" | "docker";
  spawn(id: string, workerType: WorkerType): Promise<WorkerHandle>;
  isExited(handle: WorkerHandle): Promise<boolean>;
  exitCode(handle: WorkerHandle): Promise<number | null>;
  kill(handle: WorkerHandle): Promise<void>;
  forceKill(handle: WorkerHandle): Promise<void>;
  waitExited(handles: WorkerHandle[], timeoutMs: number): Promise<void>;
  cleanup?(): Promise<void>;
}

function processBackend(): WorkerBackend {
  const collectorPath = new URL("collector.ts", import.meta.url).pathname;
  const workerPath = new URL("worker.ts", import.meta.url).pathname;
  return {
    mode: "process",
    async spawn(id, workerType) {
      const entryPath = workerType === "collector" ? collectorPath : workerPath;
      const envKey = workerType === "collector" ? "COLLECTOR_PAIR_ID" : "WORKER_STRATEGY_NAME";
      const proc = Bun.spawn(["bun", entryPath, id], {
        env: { ...process.env, [envKey]: id },
        stdout: "inherit",
        stderr: "inherit",
      });
      log.info(`Spawned ${workerType} ${id} (pid=${proc.pid})`, { id, workerType });
      return {
        id,
        workerType,
        ref: { kind: "process", proc },
        spawnedAt: Date.now(),
        failCount: 0,
        nextRetryAt: 0,
      };
    },
    async isExited(h) {
      return h.ref.kind === "process" && h.ref.proc.exitCode !== null;
    },
    async exitCode(h) {
      return h.ref.kind === "process" ? h.ref.proc.exitCode : null;
    },
    async kill(h) {
      if (h.ref.kind === "process") h.ref.proc.kill();
    },
    async forceKill(h) {
      if (h.ref.kind === "process") h.ref.proc.kill(9);
    },
    async waitExited(handles, timeoutMs) {
      const living = handles.filter(
        (h) => h.ref.kind === "process" && h.ref.proc.exitCode === null,
      );
      await Promise.race([
        Promise.allSettled(
          living.map((h) => (h.ref as { kind: "process"; proc: Subprocess }).proc.exited),
        ),
        new Promise((r) => setTimeout(r, timeoutMs)),
      ]);
    },
  };
}

function dockerBackend(cfg: DockerConfig): WorkerBackend {
  return {
    mode: "docker",
    async spawn(id, workerType) {
      const containerId = await createWorkerContainer(cfg, id, workerType);
      await startContainer(cfg, containerId);
      log.info(`Spawned ${workerType} container ${id} (${containerId.slice(0, 12)})`, {
        id,
        workerType,
      });
      return {
        id,
        workerType,
        ref: { kind: "docker", containerId },
        spawnedAt: Date.now(),
        failCount: 0,
        nextRetryAt: 0,
      };
    },
    async isExited(h) {
      if (h.ref.kind !== "docker") return false;
      const state = await inspectContainer(cfg, h.ref.containerId);
      return !state.running;
    },
    async exitCode(h) {
      if (h.ref.kind !== "docker") return null;
      const state = await inspectContainer(cfg, h.ref.containerId);
      return state.exitCode;
    },
    async kill(h) {
      if (h.ref.kind === "docker") {
        await stopContainer(cfg, h.ref.containerId, 30).catch(() => {});
      }
    },
    async forceKill(h) {
      if (h.ref.kind === "docker") {
        await killContainer(cfg, h.ref.containerId).catch(() => {});
      }
    },
    async waitExited(handles, timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const allDone = await Promise.all(
          handles.map(async (h) =>
            h.ref.kind === "docker"
              ? !(await inspectContainer(cfg, h.ref.containerId).catch(() => ({ running: false })))
                  .running
              : true,
          ),
        );
        if (allDone.every(Boolean)) return;
        await new Promise((r) => setTimeout(r, 2000));
      }
    },
    async cleanup() {
      const count = await cleanupStaleContainers(cfg);
      if (count) log.info(`Cleaned up ${count} stale container(s)`);
    },
  };
}

// ---- Orchestrator State ----

const collectors = new Map<string, WorkerHandle>();
const strategies = new Map<string, WorkerHandle>();

async function main() {
  const useDocker = process.argv.includes("--docker") || process.env.ORCHESTRATOR_MODE === "docker";

  let backend: WorkerBackend;
  if (useDocker) {
    const rt = resolveOciRuntime();
    await ensureRuntimeReady(rt);
    const dockerHost = process.env.DOCKER_HOST || rt.socket;
    const dockerNetwork = process.env.DOCKER_NETWORK || "btr-net";
    const dockerImage = process.env.DOCKER_IMAGE || "btr-alm";
    backend = dockerBackend({ host: dockerHost, network: dockerNetwork, image: dockerImage });
    log.info(`Using ${rt.name} runtime (socket=${dockerHost}, network=${dockerNetwork})`);
  } else {
    backend = processBackend();
    log.info("Orchestrator using process backend (Bun.spawn)");
  }

  if (backend.cleanup) await backend.cleanup();

  const redis = createRedis();

  const rpcCount = await loadRpcOverrides(redis);
  if (rpcCount) log.info(`Loaded ${rpcCount} RPC override(s) from DragonflyDB`);

  // Acquire orchestrator singleton lock
  const lockTtl = ORCHESTRATOR_LOCK_TTL * 2;
  const acquired = await acquireLock(redis, KEYS.orchestratorLock, lockValue, lockTtl);
  if (!acquired) {
    log.error("Orchestrator already running (lock held). Exiting.");
    redis.close();
    process.exit(1);
  }
  log.info(`Orchestrator acquired lock (pid=${process.pid})`);

  // ---- Seeding: pair configs ----
  const existingConfigIds = await pairCfg.ids(redis);
  if (!existingConfigIds.length) {
    const envPairs = loadPairConfigs();
    if (envPairs.length) {
      await Promise.all(envPairs.map((pair) => pairCfg.set(redis, pairToConfigEntry(pair))));
      log.info(`Seeded ${envPairs.length} pair config(s) from env into DragonflyDB`);
    }
  }

  // ---- Seeding: strategy configs ----
  const existingStrategyNames = await strategyCfg.ids(redis);
  if (!existingStrategyNames.length) {
    const envStrategies = loadStrategyConfigs();
    if (!envStrategies.length) {
      log.error("No strategies configured. Set STRATEGIES or PAIRS env vars.");
      await releaseLock(redis, KEYS.orchestratorLock, lockValue);
      redis.close();
      process.exit(1);
    }
    await Promise.all(envStrategies.map((s) => strategyCfg.set(redis, strategyToConfigEntry(s))));
    log.info(`Seeded ${envStrategies.length} strategy config(s) from env into DragonflyDB`);
  }

  // ---- Seeding: DEX metadata (upsert missing) ----
  const existingDexs = await dexCfg.getAll(redis);
  const existingDexIds = new Set(existingDexs.map((d) => d.id));
  const newDexEntries: DexMetadata[] = Object.entries(DEX_DISPLAY_NAMES)
    .filter(([id]) => !existingDexIds.has(id))
    .map(([id, meta]) => ({ id, ...meta }));
  if (newDexEntries.length) {
    await Promise.all(newDexEntries.map((d) => dexCfg.set(redis, d)));
    log.info(`Seeded ${newDexEntries.length} new DEX metadata entries into DragonflyDB`);
  }

  // ---- Seeding: pool registry ----
  for (const [pairId, pools] of Object.entries(POOL_REGISTRY)) {
    const existing = await getConfigPools(redis, pairId);
    if (!existing) {
      await setConfigPools(
        redis,
        pairId,
        pools.map((p) => ({ chain: p.chain, address: p.id, dex: p.dex })),
      );
    }
  }

  // Load strategy configs
  const strategyEntries = await strategyCfg.getAll(redis);
  const strategyConfigs = strategyEntries
    .map((entry) => {
      const s = configEntryToStrategy(entry);
      if (!s)
        log.warn(`Strategy ${entry.name}: unknown token(s) for pair ${entry.pairId}, skipping`);
      return s;
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  if (!strategyConfigs.length) {
    log.error("No valid strategy configs in DragonflyDB.");
    await releaseLock(redis, KEYS.orchestratorLock, lockValue);
    redis.close();
    process.exit(1);
  }

  log.info(`Orchestrator starting — ${strategyConfigs.length} strategy(ies)`);

  let strategyNames = strategyConfigs.map((s) => s.name);
  await redis.sadd(KEYS.workers, ...strategyNames);

  // Dedupe pair IDs from strategies for collectors
  const collectorPairIds = new Set<string>();
  for (const s of strategyConfigs) collectorPairIds.add(s.pairId);

  // Seed collector config
  const existingCollectorIds = await getConfigCollectorPairIds(redis);
  const existingCollectorSet = new Set(existingCollectorIds);
  const newCollectorIds = [...collectorPairIds].filter((id) => !existingCollectorSet.has(id));
  if (newCollectorIds.length) {
    await Promise.all(newCollectorIds.map((id) => addConfigCollectorPair(redis, id)));
  }

  let sub: typeof redis | null = null;

  async function spawnWorker(map: Map<string, WorkerHandle>, id: string, workerType: WorkerType) {
    const existing = map.get(id);
    const handle = await backend.spawn(id, workerType);
    handle.failCount = existing?.failCount ?? 0;
    map.set(id, handle);
  }

  const spawnCollector = (pairId: string) => spawnWorker(collectors, pairId, "collector");
  const spawnStrategy = (name: string) => spawnWorker(strategies, name, "strategy");

  /** Ensure a collector is running for a pair. Returns true if already running. */
  async function ensureCollector(pairId: string): Promise<boolean> {
    const handle = collectors.get(pairId);
    if (handle && !(await backend.isExited(handle))) return true;
    await spawnCollector(pairId);
    return false;
  }

  /** Monitor a set of workers (collectors or strategies). */
  async function healthCheckWorkers(
    workerMap: Map<string, WorkerHandle>,
    ids: string[],
    heartbeatKey: (id: string) => string,
    restartingKey: (id: string) => string,
    spawnFn: (id: string) => Promise<void>,
    getStateFn: (id: string) => Promise<{ status?: string; errorMsg?: string } | null>,
  ) {
    const now = Date.now();
    for (const id of ids) {
      const hb = await redis.get(heartbeatKey(id));
      const handle = workerMap.get(id);
      if (!handle) {
        log.warn(`Worker ${id} not tracked — respawning`, { id });
        await spawnFn(id);
        continue;
      }

      const exited = await backend.isExited(handle);
      if (exited) {
        if (handle.failCount >= MAX_FAIL_COUNT) continue;

        const restarting = await redis.get(restartingKey(id));
        if (restarting) {
          await redis.del(restartingKey(id));
          handle.failCount = 0;
          log.info(`${handle.workerType} ${id} restart requested — respawning immediately`, {
            id,
          });
          await spawnFn(id);
          continue;
        }

        if (handle.nextRetryAt > now) continue;

        if (handle.nextRetryAt === 0) {
          handle.failCount++;
          const backoff = Math.min(
            HEALTH_CHECK_INTERVAL * 2 ** handle.failCount,
            MAX_RESPAWN_BACKOFF_MS,
          );
          handle.nextRetryAt = now + backoff;
          const code = await backend.exitCode(handle);
          log.warn(
            `${handle.workerType} ${id} exited (code=${code}) — respawn in ${Math.round(backoff / 1000)}s (attempt ${handle.failCount})`,
            { id },
          );
          continue;
        }

        await spawnFn(id);
        continue;
      }

      if (hb) {
        handle.failCount = 0;
        handle.nextRetryAt = 0;
      }

      try {
        const ws = await getStateFn(id);
        if (ws?.status === "error") {
          log.warn(`${handle.workerType} ${id} reporting error: ${ws.errorMsg ?? "unknown"}`, {
            id,
          });
        }
      } catch {}

      if (!hb && now - handle.spawnedAt > HEARTBEAT_TIMEOUT * 2) {
        log.warn(`${handle.workerType} ${id} heartbeat missing — killing`, { id });
        await backend.kill(handle);
      }
    }
  }

  // Health-check + lock refresh loop
  let healthCheckRunning = false;
  const healthInterval = setInterval(async () => {
    if (healthCheckRunning) return;
    healthCheckRunning = true;
    try {
      const refreshed = await refreshLock(redis, KEYS.orchestratorLock, lockValue, lockTtl);
      if (!refreshed) {
        log.error("Orchestrator lost lock — shutting down");
        shutdown();
        return;
      }

      // Health-check collectors
      await healthCheckWorkers(
        collectors,
        [...collectorPairIds],
        KEYS.collectorHeartbeat,
        KEYS.collectorRestarting,
        spawnCollector,
        (id) => getCollectorState(redis, id),
      );

      // Health-check strategy runners
      await healthCheckWorkers(
        strategies,
        strategyNames,
        KEYS.workerHeartbeat,
        KEYS.workerRestarting,
        spawnStrategy,
        (id) => getWorkerState(redis, id),
      );
    } catch (e) {
      log.error(`Health check error: ${errMsg(e)}`);
    } finally {
      healthCheckRunning = false;
    }
  }, HEALTH_CHECK_INTERVAL);

  // Graceful shutdown
  let shutdownCalled = false;
  async function shutdown() {
    if (shutdownCalled) return;
    shutdownCalled = true;
    log.info("Orchestrator shutting down...");
    clearInterval(healthInterval);

    try {
      await publishControl(redis, { type: "SHUTDOWN" });
    } catch {
      /* best-effort */
    }

    const allHandles = [...collectors.values(), ...strategies.values()];
    await backend.waitExited(allHandles, SHUTDOWN_GRACE_MS);

    for (const handle of allHandles) {
      if (!(await backend.isExited(handle))) {
        log.warn(`Force-killing ${handle.workerType} ${handle.id}`);
        await backend.forceKill(handle);
      }
    }

    if (backend.cleanup) await backend.cleanup();

    try {
      await releaseLock(redis, KEYS.orchestratorLock, lockValue);
    } catch {
      /* best-effort */
    }

    await log.shutdown();

    try {
      if (sub) sub.close();
      redis.close();
    } catch {
      /* best-effort */
    }
    process.exit(0);
  }

  // Config reconciliation
  let reconciling = false;
  let reconcilePending = false;
  async function reconcileFromConfig() {
    if (reconciling) {
      reconcilePending = true;
      return;
    }
    reconciling = true;
    try {
      const entries = await strategyCfg.getAll(redis);
      const newNames = new Set(entries.map((e) => e.name));
      const oldNames = new Set(strategyNames);

      // Derive new collector pairs from strategies
      const newPairIds = new Set(entries.map((e) => e.pairId));

      // Remove strategies for deleted entries
      for (const name of oldNames) {
        if (!newNames.has(name)) {
          log.info(`Config reconcile: stopping removed strategy ${name}`);
          const handle = strategies.get(name);
          if (handle) await backend.kill(handle);
          strategies.delete(name);
          const store = new DragonflyStore(redis, name, "btr:strategy");
          await store.deleteAll();
        }
      }

      // Add/restart strategies for new/modified entries
      for (const entry of entries) {
        // Ensure collector exists for this pair
        if (!collectorPairIds.has(entry.pairId)) {
          await addConfigCollectorPair(redis, entry.pairId);
          collectorPairIds.add(entry.pairId);
          await spawnCollector(entry.pairId);
        } else {
          await ensureCollector(entry.pairId);
        }

        if (oldNames.has(entry.name)) {
          const handle = strategies.get(entry.name);
          if (handle) {
            log.info(`Config reconcile: restarting modified strategy ${entry.name}`);
            await backend.kill(handle);
            await spawnStrategy(entry.name);
          }
        } else {
          log.info(`Config reconcile: starting new strategy ${entry.name}`);
          await spawnStrategy(entry.name);
        }
      }

      strategyNames = [...newNames];
      await redis.del(KEYS.workers);
      if (strategyNames.length) await redis.sadd(KEYS.workers, ...strategyNames);
      log.info(
        `Config reconciled — ${strategyNames.length} strategy(ies), ${collectorPairIds.size} collector(s)`,
      );
    } finally {
      reconciling = false;
      if (reconcilePending) {
        reconcilePending = false;
        reconcileFromConfig().catch((e) => log.error(`Config reconcile failed: ${errMsg(e)}`));
      }
    }
  }

  // Subscribe to config changes BEFORE spawning workers
  async function connectSubscriber() {
    try {
      if (sub) {
        try {
          sub.close();
        } catch {}
      }
      sub = await redis.duplicate();
      await sub.subscribe(CHANNELS.control, (message: string) => {
        try {
          const cmd = JSON.parse(message);
          if (cmd.type === "CONFIG_CHANGED") {
            reconcileFromConfig().catch((e) => log.error(`Config reconcile failed: ${errMsg(e)}`));
          } else if (cmd.type === "RPC_CHANGED") {
            const cid = cmd.chainId as number | undefined;
            if (cid) {
              getRpcConfig(redis, cid)
                .then((rpcs) => {
                  setChainRpcs(cid, rpcs ?? []);
                  invalidateClients(cid);
                  log.info(`RPC config updated for chain ${cid}`);
                })
                .catch((e) => log.warn(`RPC reload failed: ${errMsg(e)}`));
            }
          }
        } catch (e) {
          log.warn(`Orchestrator control message parse error: ${errMsg(e)}`);
        }
      });
    } catch (e) {
      log.warn(`Orchestrator subscriber setup failed: ${errMsg(e)}, retrying...`);
      setTimeout(connectSubscriber, SUBSCRIBER_RECONNECT_MS);
    }
  }
  await connectSubscriber();

  // Spawn collectors first, then strategy runners
  await Promise.all([...collectorPairIds].map(spawnCollector));
  // Brief delay to let collectors start before strategies read their data
  await new Promise((r) => setTimeout(r, COLLECTOR_STARTUP_DELAY_MS));
  await Promise.all(strategyNames.map(spawnStrategy));

  // Register collectors in DragonflyDB
  if (collectorPairIds.size) {
    await redis.sadd(KEYS.collectors, ...collectorPairIds);
  }

  process.on("SIGHUP", () => {
    reconcileFromConfig().catch((e) => log.error(`Config reload failed: ${errMsg(e)}`));
  });

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch(async (e) => {
  log.error(`Orchestrator fatal: ${errMsg(e)}`);
  await log.shutdown();
  process.exitCode = 1;
});
