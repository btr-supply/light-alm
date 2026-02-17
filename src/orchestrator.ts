import { log, isValidLogLevel, errMsg } from "./utils";
import { loadPairConfigs } from "./config/pairs";
import { startApi } from "./api";
import {
  ORCHESTRATOR_LOCK_TTL,
  HEALTH_CHECK_INTERVAL,
  HEARTBEAT_TIMEOUT,
  DEFAULT_API_PORT,
  SHUTDOWN_GRACE_MS,
} from "./config/params";
import {
  createRedis,
  KEYS,
  CHANNELS,
  acquireLock,
  refreshLock,
  releaseLock,
  getWorkerState,
} from "./infra/redis";
import type { Subprocess } from "bun";

const level = process.env.LOG_LEVEL || "info";
if (isValidLogLevel(level)) log.setLevel(level);

const startTs = Date.now();
const lockValue = `orchestrator:${process.pid}:${startTs}`;

interface WorkerHandle {
  pairId: string;
  proc: Subprocess;
  spawnedAt: number;
  failCount: number;
  nextRetryAt: number;
}

const workers = new Map<string, WorkerHandle>();

const MAX_RESPAWN_BACKOFF_MS = 300_000; // 5 min cap
const MAX_FAIL_COUNT = 20;

function spawnWorker(pairId: string): WorkerHandle {
  const existing = workers.get(pairId);
  const failCount = existing?.failCount ?? 0;

  const workerPath = new URL("worker.ts", import.meta.url).pathname;
  const proc = Bun.spawn(["bun", workerPath, pairId], {
    env: { ...process.env, WORKER_PAIR_ID: pairId },
    stdout: "inherit",
    stderr: "inherit",
  });
  const handle: WorkerHandle = { pairId, proc, spawnedAt: Date.now(), failCount, nextRetryAt: 0 };
  workers.set(pairId, handle);
  log.info(`Spawned worker ${pairId} (pid=${proc.pid})`, { pairId });
  return handle;
}

async function main() {
  const redis = createRedis();

  // Acquire orchestrator singleton lock (TTL = 60s, refreshed every 10s)
  const lockTtl = ORCHESTRATOR_LOCK_TTL * 2; // 60s for safety margin
  const acquired = await acquireLock(redis, KEYS.orchestratorLock, lockValue, lockTtl);
  if (!acquired) {
    log.error("Orchestrator already running (lock held). Exiting.");
    redis.close();
    process.exit(1);
  }
  log.info(`Orchestrator acquired lock (pid=${process.pid})`);

  // Load pair configs
  const pairs = loadPairConfigs();
  if (!pairs.length) {
    log.error("No pairs configured. Set PAIRS and POOLS_* env vars.");
    await releaseLock(redis, KEYS.orchestratorLock, lockValue);
    redis.close();
    process.exit(1);
  }

  log.info(`Orchestrator starting — ${pairs.length} pair(s)`);

  // Register pair IDs in Redis SET
  let pairIds = pairs.map((p) => p.id);
  await redis.sadd(KEYS.workers, ...pairIds);

  // Spawn one worker per pair
  for (const pair of pairs) {
    spawnWorker(pair.id);
  }

  // Start API server (passes redis for state reads)
  const apiPort = parseInt(process.env.API_PORT || String(DEFAULT_API_PORT));
  startApi(apiPort, redis);

  // Health-check + lock refresh loop
  const healthInterval = setInterval(async () => {
    try {
      // Refresh orchestrator lock first (before any slow worker checks)
      const refreshed = await refreshLock(redis, KEYS.orchestratorLock, lockValue, lockTtl);
      if (!refreshed) {
        log.error("Orchestrator lost lock — shutting down");
        shutdown();
        return;
      }

      const now = Date.now();

      // Check worker heartbeats
      for (const pairId of pairIds) {
        const hb = await redis.get(KEYS.workerHeartbeat(pairId));
        const handle = workers.get(pairId);
        if (!handle) {
          log.warn(`Worker ${pairId} not tracked — respawning`, { pairId });
          spawnWorker(pairId);
          continue;
        }

        // Check if process exited
        if (handle.proc.exitCode !== null) {
          if (handle.failCount >= MAX_FAIL_COUNT) {
            continue; // Gave up
          }
          // Intentional restart via API — skip backoff
          const restarting = await redis.get(KEYS.workerRestarting(pairId));
          if (restarting) {
            await redis.del(KEYS.workerRestarting(pairId));
            handle.failCount = 0;
            log.info(`Worker ${pairId} restart requested — respawning immediately`, { pairId });
            spawnWorker(pairId);
            continue;
          }
          // Still in backoff window — wait
          if (handle.nextRetryAt > now) continue;
          // First detection or backoff elapsed — schedule or respawn
          if (handle.nextRetryAt === 0) {
            // First detection: set backoff and wait
            handle.failCount++;
            const backoff = Math.min(
              HEALTH_CHECK_INTERVAL * 2 ** handle.failCount,
              MAX_RESPAWN_BACKOFF_MS,
            );
            handle.nextRetryAt = now + backoff;
            log.warn(
              `Worker ${pairId} exited (code=${handle.proc.exitCode}) — respawn in ${Math.round(backoff / 1000)}s (attempt ${handle.failCount})`,
              { pairId },
            );
            continue;
          }
          // Backoff elapsed — respawn
          spawnWorker(pairId);
          continue;
        }

        // Reset fail count on healthy heartbeat
        if (hb) {
          handle.failCount = 0;
          handle.nextRetryAt = 0;
        }

        // Detect error-looping workers via WorkerState
        try {
          const ws = await getWorkerState(redis, pairId);
          if (ws?.status === "error") {
            log.warn(`Worker ${pairId} reporting error state: ${ws.errorMsg ?? "unknown"}`, {
              pairId,
            });
          }
        } catch {
          // Corrupted state JSON — non-fatal, continue checking other workers
        }

        // Check heartbeat expiry (only after initial grace period)
        if (!hb && now - handle.spawnedAt > HEARTBEAT_TIMEOUT * 2) {
          log.warn(`Worker ${pairId} heartbeat missing — killing (respawn on next health check)`, {
            pairId,
          });
          handle.proc.kill();
          // Don't respawn immediately — wait for exitCode to be set, handled above
        }
      }
    } catch (e) {
      log.error(`Health check error: ${errMsg(e)}`);
    }
  }, HEALTH_CHECK_INTERVAL);

  // Graceful shutdown
  let shutdownCalled = false;
  async function shutdown() {
    if (shutdownCalled) return;
    shutdownCalled = true;
    log.info("Orchestrator shutting down...");
    clearInterval(healthInterval);

    // Signal all workers to stop
    try {
      await redis.publish(CHANNELS.control, JSON.stringify({ type: "SHUTDOWN" }));
    } catch {
      // Best-effort
    }

    // Wait for all workers in parallel with shared deadline
    const timeout = new Promise((r) => setTimeout(r, SHUTDOWN_GRACE_MS));
    await Promise.race([
      Promise.allSettled(
        [...workers.values()].filter((h) => h.proc.exitCode === null).map((h) => h.proc.exited),
      ),
      timeout,
    ]);
    // SIGKILL any survivors
    for (const [, handle] of workers) {
      if (handle.proc.exitCode === null) {
        log.warn(`Force-killing worker ${handle.pairId} (SIGKILL)`);
        handle.proc.kill(9);
      }
    }

    // Only release orchestrator lock — workers clean up their own keys via TTL
    try {
      await releaseLock(redis, KEYS.orchestratorLock, lockValue);
    } catch {
      // Best-effort cleanup
    }

    await log.shutdown();

    try {
      redis.close();
    } catch {
      // Already disconnected
    }
    process.exit(0);
  }

  // Config hot-reload: SIGHUP reconciles workers with current config
  process.on("SIGHUP", async () => {
    try {
      const newPairs = loadPairConfigs();
      const newIds = new Set(newPairs.map((p) => p.id));
      const oldIds = new Set(pairIds);

      // Stop removed workers
      for (const id of oldIds) {
        if (!newIds.has(id)) {
          log.info(`Config reload: stopping removed pair ${id}`);
          const handle = workers.get(id);
          if (handle && handle.proc.exitCode === null) handle.proc.kill();
        }
      }

      // Spawn new workers
      for (const id of newIds) {
        if (!oldIds.has(id)) {
          log.info(`Config reload: starting new pair ${id}`);
          spawnWorker(id);
        }
      }

      pairIds = [...newIds];
      await redis.del(KEYS.workers);
      if (pairIds.length) await redis.sadd(KEYS.workers, ...pairIds);
      log.info(`Config reloaded — ${pairIds.length} pair(s)`);
    } catch (e) {
      log.error(`Config reload failed: ${errMsg(e)}`);
    }
  });

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch(async (e) => {
  log.error(`Orchestrator fatal: ${errMsg(e)}`);
  await log.shutdown();
  process.exitCode = 1;
});
