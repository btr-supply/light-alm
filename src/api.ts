import { allPairIds, getPair } from "./state";
import { DragonflyStore } from "./data/store-dragonfly";
import * as o2q from "./data/store-o2";
import { defaultRangeParams } from "./strategy/optimizer";
import {
  DEFAULT_API_PORT,
  DEFAULT_CANDLE_WINDOW_MS,
  DEFAULT_TXLOG_LIMIT,
  POOL_ADDRESS_RE,
  INTERVAL_SEC_RANGE,
  MAX_POSITIONS_RANGE,
} from "./config/params";
import { DexId } from "./types";
import { TOKENS } from "./config/tokens";
import { log, bigintReplacer } from "./utils";
import { envInt } from "./config/config-utils";

const intOr = (s: string | null, fallback: number) => envInt(s ?? undefined, fallback, -Infinity);
import type { WorkerState } from "./state";
import {
  KEYS,
  publishControl,
  getWorkerState,
  getCollectorState,
  getConfigCollectorPairIds,
  addConfigCollectorPair,
  removeConfigCollectorPair,
  pairCfg,
  strategyCfg,
  dexCfg,
  getAllRpcConfigs,
  getRpcConfig,
  setRpcConfig,
  deleteRpcConfig,
  getConfigPools,
  setConfigPools,
  deleteConfigPools,
  readCollectedCandles,
} from "./infra/redis";
import type { PairConfigEntry, StrategyConfigEntry, DexMetadata } from "../shared/types";
import type { RedisClient } from "bun";
import { DEFAULT_RPCS, resolveRpcs } from "./config/chains";

const startTime = Date.now();

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
} as const;

const API_TOKEN = process.env.API_TOKEN;
const VALID_DEX_IDS = new Set(Object.values(DexId));

/** Validate pool entries shared by strategy and pair config CRUD. Returns error string or null. */
function validatePoolEntries(pools: { chain: number; address: string; dex: string }[]): string | null {
  for (const p of pools) {
    if (typeof p.chain !== "number" || p.chain <= 0) return `Invalid chain: ${p.chain}`;
    if (typeof p.address !== "string" || !POOL_ADDRESS_RE.test(p.address))
      return `Invalid pool address: ${p.address}`;
    if (!VALID_DEX_IDS.has(p.dex as DexId)) return `Unknown dex: ${p.dex}`;
  }
  return null;
}

/** Validate numeric strategy/pair params. Returns error string or null. */
function validateNumericParams(intervalSec: number, maxPositions: number): string | null {
  if (intervalSec < INTERVAL_SEC_RANGE.min || intervalSec > INTERVAL_SEC_RANGE.max)
    return `intervalSec must be ${INTERVAL_SEC_RANGE.min}-${INTERVAL_SEC_RANGE.max}`;
  if (maxPositions < MAX_POSITIONS_RANGE.min || maxPositions > MAX_POSITIONS_RANGE.max)
    return `maxPositions must be ${MAX_POSITIONS_RANGE.min}-${MAX_POSITIONS_RANGE.max}`;
  return null;
}

/** Validate PRA/RS thresholds. Returns error string or null. */
function validateThresholds(thresholds: { pra: number; rs: number }): string | null {
  if (thresholds.pra <= 0 || thresholds.pra >= 1 || thresholds.rs <= 0 || thresholds.rs >= 1)
    return "thresholds.pra and .rs must be in (0, 1)";
  return null;
}

function json(data: unknown, status = 200) {
  return new Response(
    JSON.stringify(data, bigintReplacer),
    {
      status,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    },
  );
}

/** Validate pair ID is TOKEN0-TOKEN1 with known tokens. */
function validatePairId(pairId: string): string | null {
  const parts = pairId.split("-");
  if (parts.length !== 2 || !TOKENS[parts[0]] || !TOKENS[parts[1]])
    return "Invalid pairId — must be TOKEN0-TOKEN1 with known tokens";
  return null;
}

/** Validate shared config body fields (pools, intervals, thresholds). Returns {validated, error}. */
function validateConfigBody(body: { pools?: any[]; intervalSec?: number; maxPositions?: number; thresholds?: { pra: number; rs: number } }) {
  if (!body.pools?.length) return { error: "pools required" };
  const poolErr = validatePoolEntries(body.pools);
  if (poolErr) return { error: poolErr };
  const intervalSec = body.intervalSec ?? 900;
  const maxPositions = body.maxPositions ?? 3;
  const numErr = validateNumericParams(intervalSec, maxPositions);
  if (numErr) return { error: numErr };
  const thresholds = body.thresholds ?? { pra: 0.05, rs: 0.25 };
  const thrErr = validateThresholds(thresholds);
  if (thrErr) return { error: thrErr };
  return { intervalSec, maxPositions, thresholds };
}

/** Parse JSON body, returning a Response on failure. */
async function parseBody<T>(req: Request): Promise<T | Response> {
  try { return (await req.json()) as T; }
  catch { return json({ error: "Invalid JSON body" }, 400); }
}

// Paths requiring orchestrated mode (checked as prefix)
const ORCHESTRATED_PREFIXES = [
  "/api/strategies",
  "/api/config/strategies",
  "/api/config/dexs",
  "/api/config/pairs",
  "/api/config/pools",
  "/api/config/collectors",
  "/api/cluster",
  "/api/orchestrator",
  "/api/collectors",
];

/**
 * Start the API server.
 * @param port - Listen port
 * @param redis - Optional Redis client for orchestrated mode. If null, falls back to in-memory state.
 */
export function startApi(port = DEFAULT_API_PORT, redis?: RedisClient) {
  const orchestrated = !!redis;

  // DragonflyStore cache for position reads in orchestrated mode
  const storeCache = new Map<string, DragonflyStore>();
  function getStore(pairId: string, prefix = "btr:pair"): DragonflyStore | null {
    if (!redis) return getPair(pairId)?.store ?? null;
    const cacheKey = `${prefix}:${pairId}`;
    if (!storeCache.has(cacheKey))
      storeCache.set(cacheKey, new DragonflyStore(redis, pairId, prefix));
    return storeCache.get(cacheKey)!;
  }

  // Helper: get strategy names from Redis
  async function strategyNames(): Promise<string[]> {
    if (!orchestrated) return [];
    return redis!.smembers(KEYS.workers);
  }

  // Helper: get worker state from Redis
  async function workerState(name: string): Promise<WorkerState | null> {
    if (!orchestrated) return null;
    return getWorkerState(redis!, name);
  }

  // Shared data handlers for strategy sub-routes
  type DataHandler = (pairId: string, name: string, url: URL) => Promise<Response>;

  const dataHandlers: Record<string, DataHandler> = {
    positions: async (_pairId, name) => {
      const store = getStore(name, "btr:strategy");
      if (!store) return json({ error: "Strategy not found" }, 404);
      return json(await store.getPositions());
    },

    candles: async (pairId, _name, url) => {
      const from = intOr(url.searchParams.get("from"), Date.now() - DEFAULT_CANDLE_WINDOW_MS);
      const to = intOr(url.searchParams.get("to"), Date.now());
      const o2Candles = await o2q.getCandles(pairId, from, to);
      if (o2Candles.length) return json(o2Candles);
      if (redis) {
        const buf = await readCollectedCandles(redis, pairId);
        return json(buf.filter((c) => c.ts >= from && c.ts <= to));
      }
      return json([]);
    },

    txlog: async (pairId, _name, url) => {
      const limit = intOr(url.searchParams.get("limit"), DEFAULT_TXLOG_LIMIT);
      return json(await o2q.getTxLogs(pairId, limit));
    },

    snapshots: async (pairId, _name, url) => {
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      const limit = url.searchParams.get("limit");
      return json(
        await o2q.getEpochSnapshots(
          pairId,
          from ? intOr(from, 0) : undefined,
          to ? intOr(to, Date.now()) : undefined,
          limit ? intOr(limit, 100) : undefined,
        ),
      );
    },

    analyses: async (pairId, _name, url) => {
      const pool = url.searchParams.get("pool");
      const chain = url.searchParams.get("chain");
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      if (pool && chain) {
        return json(
          await o2q.getPoolAnalyses(
            pool,
            intOr(chain, 0),
            from ? intOr(from, 0) : undefined,
            to ? intOr(to, Date.now()) : undefined,
          ),
        );
      }
      if (from || to) {
        return json(
          await o2q.getPoolAnalysesByPair(
            pairId,
            intOr(from, 0),
            intOr(to, Date.now()),
          ),
        );
      }
      return json(await o2q.getLatestAnalysesForPools(pairId));
    },

    allocations: async (pairId, name, url) => {
      const limit = url.searchParams.get("limit");
      if (limit) {
        return json(await o2q.getPairAllocations(pairId, intOr(limit, 10)));
      }
      const o2Alloc = await o2q.getLatestPairAllocation(pairId);
      if (o2Alloc) return json(o2Alloc);
      // Fallback: build allocation from worker state
      const state = await workerState(name);
      if (state) {
        return json({
          ts: state.lastDecisionTs,
          currentApr: state.currentApr ?? 0,
          optimalApr: state.optimalApr ?? 0,
          improvement: (state.optimalApr ?? 0) - (state.currentApr ?? 0),
          decision: state.lastDecision ?? "HOLD",
          targetAllocations: state.targetAllocations ?? [],
          currentAllocations: [],
        });
      }
      return json(null);
    },

    "optimal-ranges": async (pairId, name) => {
      const o2Ranges = await o2q.getLatestAnalysesForPools(pairId);
      if (o2Ranges.length) return json(o2Ranges);
      const state = await workerState(name);
      if (state?.optimalRanges?.length) return json(state.optimalRanges);
      return json([]);
    },
  };

  const server = Bun.serve({
    port,
    async fetch(req) {
      if (req.method === "OPTIONS") {
        return new Response(null, { headers: CORS_HEADERS });
      }

      const url = new URL(req.url);
      const path = url.pathname;
      const method = req.method;

      // ---- Auth guard for all write methods ----
      if (method === "PUT" || method === "POST" || method === "DELETE") {
        if (API_TOKEN && req.headers.get("authorization") !== `Bearer ${API_TOKEN}`) {
          return json({ error: "Unauthorized" }, 401);
        }
      }

      // ---- Orchestrated-mode guard for known prefixes ----
      if (!orchestrated && ORCHESTRATED_PREFIXES.some((p) => path.startsWith(p))) {
        return json({ error: "Not in orchestrated mode" }, 400);
      }

      // ---- Health ----
      if (path === "/api/health") {
        const ids = orchestrated ? await redis!.smembers(KEYS.workers) : allPairIds();
        return json({ ok: true, uptime: Math.floor((Date.now() - startTime) / 1000), pairs: ids });
      }

      // ================================================================
      // Strategy endpoints
      // ================================================================

      // ---- Strategy list ----
      if (path === "/api/strategies") {
        const names = await strategyNames();
        const strategies = await Promise.all(
          names.map(async (name) => {
            const store = getStore(name, "btr:strategy");
            const [state, positions] = await Promise.all([
              workerState(name),
              store ? store.getPositions() : Promise.resolve([]),
            ]);
            const pairId = state?.pairId ?? name;
            const alloc = await o2q.getLatestPairAllocation(pairId);
            const tvlUsd = positions.reduce(
              (sum, p) => sum + (typeof p.entryValueUsd === "number" ? p.entryValueUsd : 0),
              0,
            );
            return {
              name,
              pairId,
              tvlUsd,
              apy: alloc?.currentApr ?? state?.currentApr ?? 0,
              positions: positions.length,
              decision: state?.lastDecision ?? "HOLD",
              decisionTs: state?.lastDecisionTs ?? 0,
              epoch: state?.epoch ?? 0,
              status: state?.status ?? "unknown",
            };
          }),
        );
        return json(strategies);
      }

      // ---- Per-strategy endpoints ----
      const strategyMatch = path.match(/^\/api\/strategies\/([^/]+)\/(.+)$/);
      if (strategyMatch) {
        const name = strategyMatch[1];
        const sub = strategyMatch[2];

        if (sub === "status") {
          const state = await workerState(name);
          if (!state) return json({ error: "Strategy not found" }, 404);
          return json({
            name,
            pairId: state.pairId,
            epoch: state.epoch,
            decision: state.lastDecision,
            decisionTs: state.lastDecisionTs,
            forces: state.forces ?? null,
            optimizer: {
              params: state.optParams ?? defaultRangeParams(),
              fitness: state.optFitness ?? 0,
            },
            regime: state.regime ?? null,
            killSwitch: state.killSwitch ?? null,
            status: state.status,
            currentApr: state.currentApr ?? 0,
            optimalApr: state.optimalApr ?? 0,
          });
        }

        // Dispatch to shared data handlers
        const handler = dataHandlers[sub];
        if (handler) {
          const state = await workerState(name);
          const pairId = state?.pairId ?? name;
          return handler(pairId, name, url);
        }
      }

      // ================================================================
      // Config CRUD: strategies
      // ================================================================

      if (path === "/api/config/strategies" && method === "GET") {
        return json(await strategyCfg.getAll(redis!));
      }

      const configStrategyMatch = path.match(/^\/api\/config\/strategies\/([^/]+)$/);
      if (configStrategyMatch) {
        const cfgName = configStrategyMatch[1];

        if (method === "GET") {
          const entry = await strategyCfg.get(redis!, cfgName);
          return entry ? json(entry) : json({ error: "Strategy config not found" }, 404);
        }

        if (method === "PUT") {
          const body = await parseBody<Partial<StrategyConfigEntry>>(req);
          if (body instanceof Response) return body;
          if (!body.pairId) return json({ error: "pairId required" }, 400);
          const pairErr = validatePairId(body.pairId);
          if (pairErr) return json({ error: pairErr }, 400);
          const v = validateConfigBody(body);
          if ("error" in v) return json({ error: v.error }, 400);
          const entry: StrategyConfigEntry = {
            name: cfgName, pairId: body.pairId,
            pkEnvVar: body.pkEnvVar ?? `PK_${cfgName.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase()}`,
            pools: body.pools!, ...v,
            forceParams: body.forceParams, gasReserves: body.gasReserves,
            allocationPct: body.allocationPct, rpcOverrides: body.rpcOverrides,
          };
          await strategyCfg.set(redis!, entry);
          return json({ ok: true, config: entry });
        }

        if (method === "DELETE") {
          await strategyCfg.del(redis!, cfgName);
          return json({ ok: true, message: `Strategy config ${cfgName} deleted` });
        }

        return json({ error: "Method not allowed" }, 405);
      }

      // ================================================================
      // Config CRUD: dexs
      // ================================================================

      if (path === "/api/config/dexs" && method === "GET") {
        return json(await dexCfg.getAll(redis!));
      }

      const configDexMatch = path.match(/^\/api\/config\/dexs\/([^/]+)$/);
      if (configDexMatch) {
        const dexId = configDexMatch[1];

        if (method === "GET") {
          const entry = await dexCfg.get(redis!, dexId);
          return entry ? json(entry) : json({ error: "DEX config not found" }, 404);
        }

        if (method === "PUT") {
          const body = await parseBody<Partial<DexMetadata>>(req);
          if (body instanceof Response) return body;

          const name = body.name;
          const ammType = body.ammType;
          const poolTypes = body.poolTypes;
          if (!name || typeof name !== "string") {
            return json({ error: "name required (string)" }, 400);
          }
          if (!ammType || typeof ammType !== "string") {
            return json({ error: "ammType required (string)" }, 400);
          }
          if (!Array.isArray(poolTypes) || !poolTypes.length) {
            return json({ error: "poolTypes required (non-empty array)" }, 400);
          }

          const entry: DexMetadata = {
            id: dexId,
            name,
            ammType,
            poolTypes,
            landingUrl: body.landingUrl,
            twitterUrl: body.twitterUrl,
          };
          await dexCfg.set(redis!, entry);
          return json({ ok: true, config: entry });
        }

        if (method === "DELETE") {
          await dexCfg.del(redis!, dexId);
          return json({ ok: true, message: `DEX config ${dexId} deleted` });
        }

        return json({ error: "Method not allowed" }, 405);
      }

      // ================================================================
      // Config CRUD: pools
      // ================================================================

      const configPoolsMatch = path.match(/^\/api\/config\/pools\/([^/]+)$/);
      if (configPoolsMatch) {
        const poolPairId = configPoolsMatch[1];

        if (method === "GET") {
          const pools = await getConfigPools(redis!, poolPairId);
          return pools ? json(pools) : json({ error: "Pool config not found" }, 404);
        }

        if (method === "PUT") {
          const body = await parseBody<{ pools?: { chain: number; address: string; dex: string }[] }>(req);
          if (body instanceof Response) return body;

          if (!Array.isArray(body.pools) || !body.pools.length) {
            return json({ error: "pools required (non-empty array)" }, 400);
          }

          const poolErr = validatePoolEntries(body.pools);
          if (poolErr) return json({ error: poolErr }, 400);

          await setConfigPools(redis!, poolPairId, body.pools);
          return json({ ok: true, pairId: poolPairId, pools: body.pools });
        }

        if (method === "DELETE") {
          await deleteConfigPools(redis!, poolPairId);
          return json({ ok: true, message: `Pool config for ${poolPairId} deleted` });
        }

        return json({ error: "Method not allowed" }, 405);
      }

      // ================================================================
      // Cluster management
      // ================================================================

      if (path === "/api/cluster") {
        const [collectorIds, stratNames] = await Promise.all([
          redis!.smembers(KEYS.collectors),
          redis!.smembers(KEYS.workers),
        ]);

        const [collectors, strategies] = await Promise.all([
          Promise.all(
            collectorIds.map(async (id) => {
              const [hb, state] = await Promise.all([
                redis!.get(KEYS.collectorHeartbeat(id)),
                getCollectorState(redis!, id),
              ]);
              return {
                id,
                workerType: "collector" as const,
                status: state?.status ?? "unknown",
                pid: state?.pid ?? 0,
                uptimeMs: state?.uptimeMs ?? 0,
                alive: !!hb,
                errorMsg: state?.errorMsg,
                pairId: id,
                lastHeartbeat: hb ? intOr(hb, 0) : null,
                candleCount: state?.candleCount,
                snapshotCount: state?.snapshotCount,
              };
            }),
          ),
          Promise.all(
            stratNames.map(async (name) => {
              const [hb, state] = await Promise.all([
                redis!.get(KEYS.workerHeartbeat(name)),
                workerState(name),
              ]);
              return {
                id: name,
                workerType: "strategy" as const,
                status: state?.status ?? "unknown",
                pid: state?.pid ?? 0,
                uptimeMs: state?.uptimeMs ?? 0,
                alive: !!hb,
                errorMsg: state?.errorMsg,
                pairId: state?.pairId ?? "",
                strategyName: name,
                lastHeartbeat: hb ? intOr(hb, 0) : null,
                epoch: state?.epoch,
                lastDecision: state?.lastDecision,
              };
            }),
          ),
        ]);

        return json({
          workers: collectors.length + strategies.length,
          uptime: Math.floor((Date.now() - startTime) / 1000),
          collectors,
          strategies,
        });
      }

      // ---- Strategy control: start/stop/pause/restart ----
      const strategyControlMatch = path.match(
        /^\/api\/orchestrator\/strategies\/([^/]+)\/(start|stop|pause|restart)$/,
      );
      if (strategyControlMatch && method === "POST") {
        const targetName = strategyControlMatch[1];
        const action = strategyControlMatch[2].toUpperCase();
        await publishControl(redis!, { type: `${action}_STRATEGY`, target: targetName });
        return json({ ok: true, message: `${action} command sent for strategy ${targetName}` });
      }

      // ---- Collector control: start/stop/restart ----
      const collectorControlMatch = path.match(
        /^\/api\/orchestrator\/collectors\/([^/]+)\/(start|stop|restart)$/,
      );
      if (collectorControlMatch && method === "POST") {
        const targetPairId = collectorControlMatch[1];
        const action = collectorControlMatch[2].toUpperCase();
        await publishControl(redis!, { type: `${action}_COLLECTOR`, pairId: targetPairId });
        return json({ ok: true, message: `${action} command sent for collector ${targetPairId}` });
      }

      // ---- Collector config ----
      if (path === "/api/config/collectors" && method === "GET") {
        return json(await getConfigCollectorPairIds(redis!));
      }

      const collectorConfigMatch = path.match(/^\/api\/config\/collectors\/([^/]+)$/);
      if (collectorConfigMatch) {
        const cpId = collectorConfigMatch[1];
        if (method === "PUT") {
          await addConfigCollectorPair(redis!, cpId);
          await publishControl(redis!, { type: "CONFIG_CHANGED" });
          return json({ ok: true, message: `Collector pair ${cpId} added` });
        }
        if (method === "DELETE") {
          await removeConfigCollectorPair(redis!, cpId);
          return json({ ok: true, message: `Collector pair ${cpId} removed` });
        }
      }

      // ---- Worker restart (orchestrated mode only) ----
      const restartMatch = path.match(/^\/api\/orchestrator\/workers\/([^/]+)\/restart$/);
      if (restartMatch && method === "POST") {
        const targetPairId = restartMatch[1];
        await publishControl(redis!, { type: "RESTART", pairId: targetPairId });
        return json({ ok: true, message: `Restart command sent for ${targetPairId}` });
      }

      // ---- Config CRUD: pairs (orchestrated mode only) ----
      if (path === "/api/config/pairs" && method === "GET") {
        return json(await pairCfg.getAll(redis!));
      }

      const configMatch = path.match(/^\/api\/config\/pairs\/([^/]+)$/);
      if (configMatch) {
        const cfgPairId = configMatch[1];

        if (method === "GET") {
          const entry = await pairCfg.get(redis!, cfgPairId);
          return entry ? json(entry) : json({ error: "Config not found" }, 404);
        }

        if (method === "PUT") {
          const pairErr = validatePairId(cfgPairId);
          if (pairErr) return json({ error: pairErr }, 400);
          const body = await parseBody<Partial<PairConfigEntry>>(req);
          if (body instanceof Response) return body;
          const v = validateConfigBody(body);
          if ("error" in v) return json({ error: v.error }, 400);
          const entry: PairConfigEntry = { id: cfgPairId, pools: body.pools!, ...v, forceParams: body.forceParams };
          await pairCfg.set(redis!, entry);
          return json({ ok: true, config: entry });
        }

        if (method === "DELETE") {
          await pairCfg.del(redis!, cfgPairId);
          return json({ ok: true, message: `Config ${cfgPairId} deleted` });
        }

        return json({ error: "Method not allowed" }, 405);
      }

      // ---- RPC Config ----
      if (path === "/api/config/rpcs" && method === "GET") {
        const overrides = orchestrated ? await getAllRpcConfigs(redis!) : {};
        const result: Record<number, { rpcs: string[]; source: string }> = {};
        for (const idStr of Object.keys(DEFAULT_RPCS)) {
          const chainId = Number(idStr);
          const dragonfly = overrides[chainId];
          result[chainId] = dragonfly
            ? { rpcs: dragonfly, source: "dragonfly" }
            : { rpcs: resolveRpcs(chainId), source: "env" };
        }
        return json(result);
      }

      const rpcMatch = path.match(/^\/api\/config\/rpcs\/(\d+)$/);
      if (rpcMatch) {
        const chainId = Number(rpcMatch[1]);

        if (method === "GET") {
          const rpcs = resolveRpcs(chainId);
          const dragonfly = orchestrated ? await getRpcConfig(redis!, chainId) : null;
          return json({
            chainId,
            rpcs,
            source: dragonfly ? "dragonfly" : "env",
            defaults: DEFAULT_RPCS[chainId] ?? [],
          });
        }

        if (method === "PUT") {
          if (!orchestrated) return json({ error: "Not in orchestrated mode" }, 400);

          const body = await parseBody<{ rpcs?: string[] }>(req);
          if (body instanceof Response) return body;
          if (!Array.isArray(body.rpcs) || !body.rpcs.length) {
            return json({ error: "rpcs must be a non-empty array of URLs" }, 400);
          }
          for (const u of body.rpcs) {
            if (typeof u !== "string" || !/^https?:\/\/.+/.test(u)) {
              return json({ error: `Invalid RPC URL: ${u}` }, 400);
            }
          }
          await setRpcConfig(redis!, chainId, body.rpcs);
          return json({ ok: true, chainId, rpcs: body.rpcs });
        }

        if (method === "DELETE") {
          if (!orchestrated) return json({ error: "Not in orchestrated mode" }, 400);
          await deleteRpcConfig(redis!, chainId);
          return json({ ok: true, message: `RPC override for chain ${chainId} removed` });
        }

        return json({ error: "Method not allowed" }, 405);
      }

      return json({ error: "Not found" }, 404);
    },
  });

  log.info(`API server listening on http://localhost:${port}`);
  return server;
}
