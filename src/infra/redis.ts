import { RedisClient } from "bun";
import { DEFAULT_REDIS_URL, WORKER_STATE_TTL_MS } from "../config/params";
import type { WorkerState } from "../state";

export const KEYS = {
  orchestratorLock: "btr:orchestrator:lock",
  workers: "btr:workers",
  workerLock: (pairId: string) => `btr:worker:${pairId}:lock`,
  workerHeartbeat: (pairId: string) => `btr:worker:${pairId}:heartbeat`,
  workerState: (pairId: string) => `btr:worker:${pairId}:state`,
  workerRestarting: (pairId: string) => `btr:worker:${pairId}:restarting`,
} as const;

export const CHANNELS = {
  control: "btr:control",
} as const;

export function createRedis(url?: string): RedisClient {
  const redisUrl = url || process.env.DRAGONFLY_URL || DEFAULT_REDIS_URL;
  return new RedisClient(redisUrl);
}

/** Attempt to acquire a distributed lock. Returns true if acquired. */
export async function acquireLock(
  redis: RedisClient,
  key: string,
  value: string,
  ttlMs: number,
): Promise<boolean> {
  const result = await redis.send("SET", [key, value, "PX", String(ttlMs), "NX"]);
  return result === "OK";
}

/** Refresh an existing lock's TTL. Returns true if the lock is still ours. */
export async function refreshLock(
  redis: RedisClient,
  key: string,
  value: string,
  ttlMs: number,
): Promise<boolean> {
  const script = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("pexpire", KEYS[1], ARGV[2]) else return 0 end`;
  const result = await redis.send("EVAL", [script, "1", key, value, String(ttlMs)]);
  return result === 1;
}

/** Release a lock only if we own it. */
export async function releaseLock(redis: RedisClient, key: string, value: string): Promise<void> {
  const script = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;
  await redis.send("EVAL", [script, "1", key, value]);
}

export async function getWorkerState(
  redis: RedisClient,
  pairId: string,
): Promise<WorkerState | null> {
  const raw = await redis.get(KEYS.workerState(pairId));
  return raw ? JSON.parse(raw) : null;
}

export async function setWorkerState(
  redis: RedisClient,
  pairId: string,
  state: WorkerState,
): Promise<void> {
  await redis.set(KEYS.workerState(pairId), JSON.stringify(state), "PX", WORKER_STATE_TTL_MS);
}
