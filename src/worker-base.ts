/**
 * Common worker base for both collector and strategy runner workers.
 * A "worker" is any independent process managed by the orchestrator.
 * Worker types: "collector" (data collection) and "strategy" (strategy execution).
 */
import { errMsg } from "../shared/format";
import { log } from "./utils";
import { initLogLevel } from "./infra/logger";
import {
  WORKER_LOCK_TTL,
  WORKER_HEARTBEAT_INTERVAL,
  WORKER_HEARTBEAT_TTL,
  RESTARTING_KEY_TTL_MS,
  SUBSCRIBER_RECONNECT_MS,
} from "./config/params";
import { configEntryToPair, loadPairConfigs } from "./config/pairs";
import { configEntryToStrategy, loadStrategyConfigs } from "./config/strategies";
import type { PairConfig, StrategyConfig } from "./types";
import {
  createRedis,
  CHANNELS,
  acquireLock,
  refreshLock,
  releaseLock,
  getRpcConfig,
} from "./infra/redis";
import { loadRpcOverrides, setChainRpcs } from "./config/chains";
import { invalidateClients } from "./execution/tx";
import type { RedisClient } from "bun";

export type WorkerType = "collector" | "strategy";

export interface WorkerKeys {
  lock: string;
  heartbeat: string;
  restarting: string;
}

export interface WorkerBaseContext {
  type: WorkerType;
  pairId: string;
  strategyName?: string;
  redis: RedisClient;
  keys: WorkerKeys;
  lockValue: string;
  startTs: number;
}

/**
 * Bootstrap a worker: parse args, set log level, connect Redis, load RPCs, acquire lock.
 * Returns context or exits on failure.
 */
export async function bootstrapWorker(
  type: WorkerType,
  argIndex: number,
  envVar: string,
  keysFn: (id: string) => WorkerKeys,
): Promise<WorkerBaseContext> {
  const id = process.argv[argIndex] || process.env[envVar];
  if (!id) {
    console.error(`Usage: bun src/${type === "collector" ? "collector" : "worker"}.ts <id>`);
    process.exit(1);
  }

  initLogLevel();

  const startTs = Date.now();
  const lockValue = `${type}:${process.pid}:${startTs}`;
  const redis = createRedis();

  const rpcCount = await loadRpcOverrides(redis);
  if (rpcCount) log.debug(`Loaded ${rpcCount} RPC override(s) from DragonflyDB`);

  const keys = keysFn(id);
  const acquired = await acquireLock(redis, keys.lock, lockValue, WORKER_LOCK_TTL);
  if (!acquired) {
    log.error(`${type} ${id} already locked by another ${type}`);
    redis.close();
    process.exit(1);
  }
  log.info(`${type} ${id} acquired lock (pid=${process.pid})`, { pairId: id });

  // For strategy workers, derive pairId from strategy name
  const strategyName = type === "strategy" ? id : undefined;

  return { type, pairId: id, strategyName, redis, keys, lockValue, startTs };
}

/** Load config from DragonflyDB with env fallback. Exits on failure. */
export async function loadWorkerConfig<T>(
  redis: RedisClient,
  id: string,
  label: string,
  redisGet: (r: RedisClient, k: string) => Promise<any>,
  convert: (entry: any) => T | null,
  envFallback: () => T[],
  match: (item: T) => boolean,
): Promise<T> {
  const entry = await redisGet(redis, id);
  const config = entry ? convert(entry) : (envFallback().find(match) ?? null);
  if (!config) {
    log.error(`${label}: ${id} not found in DragonflyDB or env config`);
    redis.close();
    process.exit(1);
  }
  return config;
}

/** Load pair config from DragonflyDB with env fallback. Exits on failure. */
export async function loadWorkerPairConfig(
  redis: RedisClient,
  pairId: string,
  label: string,
): Promise<PairConfig> {
  const { pairCfg } = await import("./infra/redis");
  return loadWorkerConfig(
    redis, pairId, label,
    pairCfg.get, configEntryToPair, loadPairConfigs,
    (p) => p.id === pairId,
  );
}

/** Load strategy config from DragonflyDB with env fallback. Exits on failure. */
export async function loadWorkerStrategyConfig(
  redis: RedisClient,
  strategyName: string,
  label: string,
): Promise<StrategyConfig> {
  const { strategyCfg } = await import("./infra/redis");
  return loadWorkerConfig(
    redis, strategyName, label,
    strategyCfg.get, configEntryToStrategy, loadStrategyConfigs,
    (s) => s.name === strategyName,
  );
}

/**
 * Start heartbeat interval, returning the interval handle.
 */
export function startHeartbeat(
  ctx: WorkerBaseContext,
  onHeartbeat: () => Promise<void>,
): ReturnType<typeof setInterval> {
  const { redis, keys, lockValue, pairId, type } = ctx;
  return setInterval(async () => {
    try {
      await redis.set(keys.heartbeat, String(Date.now()), "PX", WORKER_HEARTBEAT_TTL);
      const stillOwned = await refreshLock(redis, keys.lock, lockValue, WORKER_LOCK_TTL);
      if (!stillOwned) {
        log.error(`${type} ${pairId}: lost lock — shutting down`);
        process.kill(process.pid, "SIGTERM");
        return;
      }
      await onHeartbeat();
    } catch (e) {
      log.warn(`${type} ${pairId}: heartbeat failed: ${errMsg(e)}`);
    }
  }, WORKER_HEARTBEAT_INTERVAL);
}

/**
 * Subscribe to the control channel for SHUTDOWN, RESTART, and RPC_CHANGED messages.
 */
export async function subscribeControl(
  ctx: WorkerBaseContext,
  restartCommand: string,
  onShutdown: () => void,
): Promise<RedisClient> {
  const { redis, pairId, type, keys, strategyName } = ctx;
  const entityId = strategyName ?? pairId;
  let sub: RedisClient;

  async function connect() {
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
          if (cmd.type === "SHUTDOWN" && (!cmd.target || cmd.target === entityId)) {
            log.info(`${type} ${entityId}: received SHUTDOWN command`, { pairId });
            onShutdown();
          } else if (
            cmd.type === restartCommand &&
            (cmd.target === entityId || cmd.pairId === pairId)
          ) {
            log.info(`${type} ${entityId}: received ${restartCommand} command`, { pairId });
            redis.set(keys.restarting, "1", "PX", RESTARTING_KEY_TTL_MS).finally(onShutdown);
          } else if (cmd.type === "RPC_CHANGED") {
            const cid = cmd.chainId as number | undefined;
            if (cid) {
              getRpcConfig(redis, cid)
                .then((rpcs) => {
                  setChainRpcs(cid, rpcs ?? []);
                  invalidateClients(cid);
                  log.info(`${type} ${entityId}: RPC config updated for chain ${cid}`, { pairId });
                })
                .catch((e) => log.warn(`${type} ${entityId}: RPC reload failed: ${errMsg(e)}`));
            }
          }
        } catch (e) {
          log.warn(`${type} ${entityId}: control message parse error: ${errMsg(e)}`);
        }
      });
    } catch (e) {
      log.warn(`${type} ${entityId}: subscriber setup failed: ${errMsg(e)}, retrying...`);
      setTimeout(connect, SUBSCRIBER_RECONNECT_MS);
    }
  }

  await connect();
  return sub!;
}

/**
 * Release lock, clean heartbeat, close connections.
 */
export async function cleanupWorker(
  ctx: WorkerBaseContext,
  sub: RedisClient | null,
): Promise<void> {
  try {
    await releaseLock(ctx.redis, ctx.keys.lock, ctx.lockValue);
    await ctx.redis.del(ctx.keys.heartbeat);
  } catch {}
  await log.shutdown();
  try {
    if (sub) sub.close();
    ctx.redis.close();
  } catch {}
}
