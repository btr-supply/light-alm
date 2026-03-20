import { RedisClient } from "bun";
import { DEFAULT_REDIS_URL, WORKER_STATE_TTL_MS, COLLECTOR_DATA_TTL_MS } from "../config/params";
import type { WorkerState, CollectorState } from "../state";
import type { Candle, PoolSnapshot } from "../types";
import type { PairConfigEntry, StrategyConfigEntry, DexMetadata } from "../../shared/types";

const prefixedKeys = (prefix: string) => ({
  lock: (id: string) => `${prefix}:${id}:lock`,
  heartbeat: (id: string) => `${prefix}:${id}:heartbeat`,
  state: (id: string) => `${prefix}:${id}:state`,
  restarting: (id: string) => `${prefix}:${id}:restarting`,
});

const workerKeys = prefixedKeys("btr:worker");
const collectorKeys = prefixedKeys("btr:collector");

export const KEYS = {
  orchestratorLock: "btr:orchestrator:lock",
  workers: "btr:workers",
  workerLock: workerKeys.lock,
  workerHeartbeat: workerKeys.heartbeat,
  workerState: workerKeys.state,
  workerRestarting: workerKeys.restarting,
  collectors: "btr:collectors",
  collectorLock: collectorKeys.lock,
  collectorHeartbeat: collectorKeys.heartbeat,
  collectorState: collectorKeys.state,
  collectorRestarting: collectorKeys.restarting,
  configCollectors: "btr:config:collectors",
  // Shared collected data (written by collectors, read by strategy runners)
  dataCandles: (pairId: string) => `btr:data:${pairId}:candles`,
  dataSnapshots: (pairId: string) => `btr:data:${pairId}:snapshots`,
  dataTs: (pairId: string) => `btr:data:${pairId}:ts`,
  // Pair config
  configPairs: "btr:config:pairs",
  configPair: (pairId: string) => `btr:config:pair:${pairId}`,
  // Strategy config
  configStrategies: "btr:config:strategies",
  configStrategy: (name: string) => `btr:config:strategy:${name}`,
  // DEX metadata
  configDexs: "btr:config:dexs",
  configDex: (id: string) => `btr:config:dex:${id}`,
  // Pool registry (per pair)
  configPools: (pairId: string) => `btr:config:pools:${pairId}`,
  // RPC
  rpcChains: "btr:config:rpc:chains",
  rpcChain: (chainId: number) => `btr:config:rpc:${chainId}`,
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

// ---- Distributed Exchange Rate Limiter ----

/**
 * Atomically reserve the next available time slot for an exchange.
 * Returns the number of milliseconds the caller must wait before proceeding.
 * Uses a Lua script for cross-process coordination via DragonflyDB.
 */
const THROTTLE_LUA = `
local last = tonumber(redis.call("get", KEYS[1]) or "0")
local interval = tonumber(ARGV[1])
local now = tonumber(ARGV[2])
local slot = math.max(now, last + interval)
redis.call("set", KEYS[1], tostring(slot), "PX", interval * 10)
return slot - now`;

export async function reserveExchangeSlot(
  redis: RedisClient,
  exchange: string,
  intervalMs: number,
): Promise<number> {
  const key = `btr:ratelimit:exchange:${exchange}`;
  const result = await redis.send("EVAL", [
    THROTTLE_LUA, "1", key, String(intervalMs), String(Date.now()),
  ]);
  return Math.max(0, Number(result));
}

// ---- Generic JSON state helpers ----

async function getJson<T>(redis: RedisClient, key: string, fallback: T): Promise<T> {
  const raw = await redis.get(key);
  return raw ? JSON.parse(raw) : fallback;
}

async function setJson(redis: RedisClient, key: string, val: unknown, ttlMs?: number): Promise<void> {
  if (ttlMs) await redis.set(key, JSON.stringify(val), "PX", ttlMs);
  else await redis.set(key, JSON.stringify(val));
}

export const getWorkerState = (r: RedisClient, name: string) =>
  getJson<WorkerState | null>(r, KEYS.workerState(name), null);
export const setWorkerState = (r: RedisClient, name: string, s: WorkerState) =>
  setJson(r, KEYS.workerState(name), s, WORKER_STATE_TTL_MS);
export const getCollectorState = (r: RedisClient, pairId: string) =>
  getJson<CollectorState | null>(r, KEYS.collectorState(pairId), null);
export const setCollectorState = (r: RedisClient, pairId: string, s: CollectorState) =>
  setJson(r, KEYS.collectorState(pairId), s, WORKER_STATE_TTL_MS);

// ---- Shared Collected Data ----

export const writeCollectedCandles = (r: RedisClient, pairId: string, candles: Candle[]) =>
  candles.length ? setJson(r, KEYS.dataCandles(pairId), candles, COLLECTOR_DATA_TTL_MS) : Promise.resolve();
export const readCollectedCandles = (r: RedisClient, pairId: string) =>
  getJson<Candle[]>(r, KEYS.dataCandles(pairId), []);
export const writeCollectedSnapshots = (r: RedisClient, pairId: string, snaps: PoolSnapshot[]) =>
  snaps.length ? setJson(r, KEYS.dataSnapshots(pairId), snaps, COLLECTOR_DATA_TTL_MS) : Promise.resolve();
export const readCollectedSnapshots = (r: RedisClient, pairId: string) =>
  getJson<PoolSnapshot[]>(r, KEYS.dataSnapshots(pairId), []);

export async function writeCollectedTs(r: RedisClient, pairId: string, ts: number): Promise<void> {
  await r.set(KEYS.dataTs(pairId), String(ts), "PX", COLLECTOR_DATA_TTL_MS);
}
export async function readCollectedTs(r: RedisClient, pairId: string): Promise<number> {
  const raw = await r.get(KEYS.dataTs(pairId));
  return raw ? Number(raw) : 0;
}

// ---- Collector Config ----

export async function getConfigCollectorPairIds(redis: RedisClient): Promise<string[]> {
  return redis.smembers(KEYS.configCollectors);
}

export async function addConfigCollectorPair(redis: RedisClient, pairId: string): Promise<void> {
  await redis.sadd(KEYS.configCollectors, pairId);
}

export async function removeConfigCollectorPair(redis: RedisClient, pairId: string): Promise<void> {
  await redis.srem(KEYS.configCollectors, pairId);
}

// ---- Control Channel ----

export const publishControl = (redis: RedisClient, payload: Record<string, unknown>) =>
  redis.publish(CHANNELS.control, JSON.stringify(payload));

// ---- Generic Config CRUD Factory ----

function configCRUD<T>(
  keyFn: (id: string) => string,
  setKey: string,
  idField: keyof T & string,
  channel?: string,
) {
  return {
    async get(redis: RedisClient, id: string): Promise<T | null> {
      const raw = await redis.get(keyFn(id));
      return raw ? JSON.parse(raw) : null;
    },
    async getAll(redis: RedisClient): Promise<T[]> {
      const ids = await redis.smembers(setKey);
      if (!ids.length) return [];
      const results = await Promise.all(ids.map((id) => this.get(redis, id)));
      return results.filter((e) => e !== null) as T[];
    },
    async set(redis: RedisClient, entry: T): Promise<void> {
      const id = (entry as Record<string, unknown>)[idField] as string;
      await Promise.all([
        redis.set(keyFn(id), JSON.stringify(entry)),
        redis.sadd(setKey, id),
      ]);
      if (channel) await publishControl(redis, { type: channel });
    },
    async del(redis: RedisClient, id: string): Promise<void> {
      await Promise.all([redis.del(keyFn(id)), redis.srem(setKey, id)]);
      if (channel) await publishControl(redis, { type: channel });
    },
    async ids(redis: RedisClient): Promise<string[]> {
      return redis.smembers(setKey);
    },
  };
}

export const pairCfg = configCRUD<PairConfigEntry>(KEYS.configPair, KEYS.configPairs, "id", "CONFIG_CHANGED");
export const strategyCfg = configCRUD<StrategyConfigEntry>(KEYS.configStrategy, KEYS.configStrategies, "name", "CONFIG_CHANGED");
export const dexCfg = configCRUD<DexMetadata>(KEYS.configDex, KEYS.configDexs, "id");

// ---- Pool Registry CRUD ----

type PoolEntry = { chain: number; address: string; dex: string };
export const getConfigPools = (r: RedisClient, pairId: string) =>
  getJson<PoolEntry[] | null>(r, KEYS.configPools(pairId), null);
export const setConfigPools = (r: RedisClient, pairId: string, pools: PoolEntry[]) =>
  setJson(r, KEYS.configPools(pairId), pools);
export const deleteConfigPools = (r: RedisClient, pairId: string) => r.del(KEYS.configPools(pairId));

// ---- RPC Config CRUD ----

export const getRpcConfig = (r: RedisClient, chainId: number) =>
  getJson<string[] | null>(r, KEYS.rpcChain(chainId), null);

export async function getAllRpcConfigs(redis: RedisClient): Promise<Record<number, string[]>> {
  const chainIds = await redis.smembers(KEYS.rpcChains);
  const entries = await Promise.all(
    chainIds.map(async (idStr) => {
      const rpcs = await getRpcConfig(redis, Number(idStr));
      return [Number(idStr), rpcs] as const;
    }),
  );
  const result: Record<number, string[]> = {};
  for (const [id, rpcs] of entries) if (rpcs) result[id] = rpcs;
  return result;
}

export async function setRpcConfig(redis: RedisClient, chainId: number, rpcs: string[]): Promise<void> {
  await Promise.all([setJson(redis, KEYS.rpcChain(chainId), rpcs), redis.sadd(KEYS.rpcChains, String(chainId))]);
  await publishControl(redis, { type: "RPC_CHANGED", chainId });
}

export async function deleteRpcConfig(redis: RedisClient, chainId: number): Promise<void> {
  await Promise.all([redis.del(KEYS.rpcChain(chainId)), redis.srem(KEYS.rpcChains, String(chainId))]);
  await publishControl(redis, { type: "RPC_CHANGED", chainId });
}
