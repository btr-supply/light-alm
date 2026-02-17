import { allPairIds, getPair } from "./state";
import { DragonflyStore } from "./data/store-dragonfly";
import * as o2q from "./data/store-o2";
import { defaultRangeParams } from "./strategy/optimizer";
import {
  DEFAULT_API_PORT,
  DEFAULT_CANDLE_WINDOW_MS,
  DEFAULT_TXLOG_LIMIT,
} from "./config/params";
import { DexId } from "./types";
import { TOKENS } from "./config/tokens";
import { log } from "./utils";
import type { WorkerState } from "./state";
import {
  KEYS,
  CHANNELS,
  getWorkerState,
  getAllConfigPairs,
  getConfigPair,
  setConfigPair,
  deleteConfigPair,
} from "./infra/redis";
import type { PairConfigEntry } from "./infra/redis";
import type { RedisClient } from "bun";

const startTime = Date.now();

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
} as const;

const API_TOKEN = process.env.API_TOKEN;

function json(data: unknown, status = 200) {
  return new Response(
    JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
    {
      status,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    },
  );
}

/**
 * Start the API server.
 * @param port - Listen port
 * @param redis - Optional Redis client for orchestrated mode. If null, falls back to in-memory state.
 */
export function startApi(port = DEFAULT_API_PORT, redis?: RedisClient) {
  const orchestrated = !!redis;

  // DragonflyStore cache for position reads in orchestrated mode
  const storeCache = new Map<string, DragonflyStore>();
  function getStore(pairId: string): DragonflyStore | null {
    if (!redis) return getPair(pairId)?.store ?? null;
    if (!storeCache.has(pairId)) storeCache.set(pairId, new DragonflyStore(redis, pairId));
    return storeCache.get(pairId)!;
  }

  // Helper: get pair IDs from Redis or in-memory registry
  async function pairIds(): Promise<string[]> {
    if (orchestrated) return redis!.smembers(KEYS.workers);
    return allPairIds();
  }

  // Helper: get worker state from Redis
  async function workerState(pairId: string): Promise<WorkerState | null> {
    if (!orchestrated) return null;
    return getWorkerState(redis!, pairId);
  }

  const server = Bun.serve({
    port,
    async fetch(req) {
      if (req.method === "OPTIONS") {
        return new Response(null, { headers: CORS_HEADERS });
      }

      const url = new URL(req.url);
      const path = url.pathname;

      // ---- Health ----
      if (path === "/api/health") {
        const ids = await pairIds();
        return json({ ok: true, uptime: Math.floor((Date.now() - startTime) / 1000), pairs: ids });
      }

      // ---- Orchestrator status (orchestrated mode only) ----
      if (path === "/api/orchestrator/status") {
        if (!orchestrated) return json({ error: "Not in orchestrated mode" }, 400);
        const ids = await pairIds();
        const workerStatuses: Record<string, unknown> = {};
        for (const id of ids) {
          const hb = await redis!.get(KEYS.workerHeartbeat(id));
          const state = await workerState(id);
          workerStatuses[id] = {
            alive: !!hb,
            lastHeartbeat: hb ? parseInt(hb) : null,
            ...state,
          };
        }
        return json({
          workers: ids.length,
          uptime: Math.floor((Date.now() - startTime) / 1000),
          statuses: workerStatuses,
        });
      }

      // ---- Auth helper for write endpoints ----
      function requireAuth(): Response | null {
        if (!API_TOKEN) return json({ error: "API_TOKEN not configured" }, 403);
        if (req.headers.get("authorization") !== `Bearer ${API_TOKEN}`) {
          return json({ error: "Unauthorized" }, 401);
        }
        return null;
      }

      // ---- Worker restart (orchestrated mode only) ----
      const restartMatch = path.match(/^\/api\/orchestrator\/workers\/([^/]+)\/restart$/);
      if (restartMatch && req.method === "POST") {
        const authErr = requireAuth();
        if (authErr) return authErr;
        if (!orchestrated) return json({ error: "Not in orchestrated mode" }, 400);
        const targetPairId = restartMatch[1];
        await redis!.publish(
          CHANNELS.control,
          JSON.stringify({ type: "RESTART", pairId: targetPairId }),
        );
        return json({ ok: true, message: `Restart command sent for ${targetPairId}` });
      }

      // ---- Config CRUD (orchestrated mode only) ----
      if (path === "/api/config/pairs" && req.method === "GET") {
        if (!orchestrated) return json({ error: "Not in orchestrated mode" }, 400);
        return json(await getAllConfigPairs(redis!));
      }

      const configMatch = path.match(/^\/api\/config\/pairs\/([^/]+)$/);
      if (configMatch) {
        if (!orchestrated) return json({ error: "Not in orchestrated mode" }, 400);
        const cfgPairId = configMatch[1];

        if (req.method === "GET") {
          const entry = await getConfigPair(redis!, cfgPairId);
          return entry ? json(entry) : json({ error: "Config not found" }, 404);
        }

        if (req.method === "PUT") {
          const authErr = requireAuth();
          if (authErr) return authErr;

          // Validate pair ID: TOKEN0-TOKEN1 format with known tokens
          const parts = cfgPairId.split("-");
          if (parts.length !== 2 || !TOKENS[parts[0]] || !TOKENS[parts[1]]) {
            return json({ error: "Invalid pair ID — must be TOKEN0-TOKEN1 with known tokens" }, 400);
          }

          const body = (await req.json()) as Partial<PairConfigEntry>;
          if (!body.pools?.length) return json({ error: "pools required" }, 400);

          // Validate pools
          const validDexIds = new Set(Object.values(DexId));
          for (const p of body.pools) {
            if (typeof p.chain !== "number" || p.chain <= 0) {
              return json({ error: `Invalid chain: ${p.chain}` }, 400);
            }
            if (typeof p.address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(p.address)) {
              return json({ error: `Invalid pool address: ${p.address}` }, 400);
            }
            if (!validDexIds.has(p.dex as DexId)) {
              return json({ error: `Unknown dex: ${p.dex}` }, 400);
            }
          }

          // Validate numeric params
          const intervalSec = body.intervalSec ?? 900;
          const maxPositions = body.maxPositions ?? 3;
          if (intervalSec < 60 || intervalSec > 86400) {
            return json({ error: "intervalSec must be 60-86400" }, 400);
          }
          if (maxPositions < 1 || maxPositions > 20) {
            return json({ error: "maxPositions must be 1-20" }, 400);
          }

          // Validate thresholds
          const thresholds = body.thresholds ?? { pra: 0.05, rs: 0.25 };
          if (thresholds.pra <= 0 || thresholds.pra >= 1 || thresholds.rs <= 0 || thresholds.rs >= 1) {
            return json({ error: "thresholds.pra and .rs must be in (0, 1)" }, 400);
          }

          const entry: PairConfigEntry = {
            id: cfgPairId,
            pools: body.pools,
            intervalSec,
            maxPositions,
            thresholds,
            forceParams: body.forceParams,
          };
          await setConfigPair(redis!, entry);
          return json({ ok: true, config: entry });
        }

        if (req.method === "DELETE") {
          const authErr = requireAuth();
          if (authErr) return authErr;
          await deleteConfigPair(redis!, cfgPairId);
          return json({ ok: true, message: `Config ${cfgPairId} deleted` });
        }
      }

      // ---- Pairs list ----
      if (path === "/api/pairs") {
        const ids = await pairIds();
        const pairs = [];
        for (const id of ids) {
          const store = getStore(id);
          const state = orchestrated ? await workerState(id) : getPair(id);
          const positions = store ? await store.getPositions() : [];
          const alloc = await o2q.getLatestPairAllocation(id);
          pairs.push({
            id,
            positions: positions.length,
            decision: state?.lastDecision ?? "HOLD",
            decisionTs: state?.lastDecisionTs ?? 0,
            currentApr: alloc?.currentApr ?? (state as WorkerState | undefined)?.currentApr ?? 0,
            optimalApr: alloc?.optimalApr ?? (state as WorkerState | undefined)?.optimalApr ?? 0,
            epoch: state?.epoch ?? 0,
          });
        }
        return json(pairs);
      }

      // ---- Per-pair endpoints ----
      const match = path.match(/^\/api\/pairs\/([^/]+)\/(.+)$/);
      if (match) {
        const pairId = match[1];
        const sub = match[2];

        if (sub === "status") {
          const state = orchestrated ? await workerState(pairId) : getPair(pairId);
          if (!state) return json({ error: "Pair not found" }, 404);
          return json({
            id: pairId,
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
          });
        }

        switch (sub) {
          case "positions": {
            const store = getStore(pairId);
            if (!store) return json({ error: "Pair not found" }, 404);
            return json(await store.getPositions());
          }

          case "allocations": {
            const limit = url.searchParams.get("limit");
            if (limit) {
              return json(await o2q.getPairAllocations(pairId, parseInt(limit)));
            }
            return json((await o2q.getLatestPairAllocation(pairId)) ?? null);
          }

          case "snapshots": {
            const from = url.searchParams.get("from");
            const to = url.searchParams.get("to");
            const limit = url.searchParams.get("limit");
            return json(
              await o2q.getEpochSnapshots(
                pairId,
                from ? parseInt(from) : undefined,
                to ? parseInt(to) : undefined,
                limit ? parseInt(limit) : undefined,
              ),
            );
          }

          case "analyses": {
            const pool = url.searchParams.get("pool");
            const chain = url.searchParams.get("chain");
            const from = url.searchParams.get("from");
            const to = url.searchParams.get("to");
            if (pool && chain) {
              return json(
                await o2q.getPoolAnalyses(
                  pool,
                  parseInt(chain),
                  from ? parseInt(from) : undefined,
                  to ? parseInt(to) : undefined,
                ),
              );
            }
            return json(await o2q.getLatestAnalysesForPools(pairId));
          }

          case "candles": {
            const from = parseInt(
              url.searchParams.get("from") || String(Date.now() - DEFAULT_CANDLE_WINDOW_MS),
            );
            const to = parseInt(url.searchParams.get("to") || String(Date.now()));
            return json(await o2q.getCandles(pairId, from, to));
          }

          case "txlog": {
            const limit = parseInt(url.searchParams.get("limit") || String(DEFAULT_TXLOG_LIMIT));
            return json(await o2q.getTxLogs(pairId, limit));
          }
        }
      }

      return json({ error: "Not found" }, 404);
    },
  });

  log.info(`API server listening on http://localhost:${port}`);
  return server;
}
