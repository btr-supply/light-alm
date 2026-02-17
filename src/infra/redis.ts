import { RedisClient } from "bun";
import { DEFAULT_REDIS_URL, WORKER_STATE_TTL_MS } from "../config/params";
import type { WorkerState } from "../state";
import type { DexId, ForceParams } from "../types";

/** Storable pair config (no derived fields like token objects). */
export interface PairConfigEntry {
  id: string;
  pools: { chain: number; address: string; dex: DexId }[];
  intervalSec: number;
  maxPositions: number;
  thresholds: { pra: number; rs: number };
  forceParams?: Partial<ForceParams>;
}

export const KEYS = {
  orchestratorLock: "btr:orchestrator:lock",
  workers: "btr:workers",
  workerLock: (pairId: string) => `btr:worker:${pairId}:lock`,
  workerHeartbeat: (pairId: string) => `btr:worker:${pairId}:heartbeat`,
  workerState: (pairId: string) => `btr:worker:${pairId}:state`,
  workerRestarting: (pairId: string) => `btr:worker:${pairId}:restarting`,
  configPairs: "btr:config:pairs",
  configPair: (pairId: string) => `btr:config:pair:${pairId}`,
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

// ---- Config CRUD ----

export async function getConfigPairIds(redis: RedisClient): Promise<string[]> {
  return redis.smembers(KEYS.configPairs);
}

export async function getConfigPair(
  redis: RedisClient,
  pairId: string,
): Promise<PairConfigEntry | null> {
  const raw = await redis.get(KEYS.configPair(pairId));
  return raw ? JSON.parse(raw) : null;
}

export async function getAllConfigPairs(redis: RedisClient): Promise<PairConfigEntry[]> {
  const ids = await getConfigPairIds(redis);
  if (!ids.length) return [];
  const results = await Promise.all(ids.map((id) => getConfigPair(redis, id)));
  return results.filter((e): e is PairConfigEntry => e !== null);
}

export async function setConfigPair(
  redis: RedisClient,
  entry: PairConfigEntry,
): Promise<void> {
  await redis.set(KEYS.configPair(entry.id), JSON.stringify(entry));
  await redis.sadd(KEYS.configPairs, entry.id);
  await redis.publish(CHANNELS.control, JSON.stringify({ type: "CONFIG_CHANGED" }));
}

export async function deleteConfigPair(
  redis: RedisClient,
  pairId: string,
): Promise<void> {
  await redis.del(KEYS.configPair(pairId));
  await redis.srem(KEYS.configPairs, pairId);
  await redis.publish(CHANNELS.control, JSON.stringify({ type: "CONFIG_CHANGED" }));
}
