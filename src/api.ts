import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { allPairIds, getPair } from "./state";
import {
  getPositions,
  getCandles,
  getTxLogs,
  getLatestPairAllocation,
  getPairAllocations,
  getEpochSnapshots,
  getPoolAnalyses,
  getLatestAnalysesForPools,
} from "./data/store";
import { defaultRangeParams } from "./strategy/optimizer";
import {
  DEFAULT_API_PORT,
  DEFAULT_CANDLE_WINDOW_MS,
  DEFAULT_TXLOG_LIMIT,
  DB_DIR,
} from "./config/params";
import { log } from "./utils";
import type { WorkerState } from "./state";
import { KEYS, CHANNELS, getWorkerState } from "./infra/redis";
import type { RedisClient } from "bun";

const startTime = Date.now();

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

// Read-only SQLite connection cache for orchestrated mode (evicted periodically)
const roDbCache = new Map<string, Database>();
const RO_CACHE_TTL_MS = 300_000; // 5 min
let lastCacheEviction = Date.now();

function getReadOnlyDb(pairId: string): Database | null {
  // Periodic eviction to release stale file descriptors
  const now = Date.now();
  if (now - lastCacheEviction > RO_CACHE_TTL_MS) {
    for (const [, db] of roDbCache) {
      try {
        db.close();
      } catch {}
    }
    roDbCache.clear();
    lastCacheEviction = now;
  }

  const cached = roDbCache.get(pairId);
  if (cached) return cached;
  const path = `${DB_DIR}/${pairId}.db`;
  if (!existsSync(path)) return null;
  const db = new Database(path, { readonly: true });
  roDbCache.set(pairId, db);
  return db;
}

/**
 * Start the API server.
 * @param port - Listen port
 * @param redis - Optional Redis client for orchestrated mode. If null, falls back to in-memory state.
 */
export function startApi(port = DEFAULT_API_PORT, redis?: RedisClient) {
  const orchestrated = !!redis;

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

  // Helper: get DB for a pair (read-only in orchestrated mode, live in CLI mode)
  function dbFor(pairId: string): Database | null {
    if (orchestrated) return getReadOnlyDb(pairId);
    const rt = getPair(pairId);
    return rt?.db ?? null;
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

      // ---- Worker restart (orchestrated mode only) ----
      const restartMatch = path.match(/^\/api\/orchestrator\/workers\/([^/]+)\/restart$/);
      if (restartMatch && req.method === "POST") {
        if (API_TOKEN && req.headers.get("authorization") !== `Bearer ${API_TOKEN}`) {
          return json({ error: "Unauthorized" }, 401);
        }
        if (!orchestrated) return json({ error: "Not in orchestrated mode" }, 400);
        const targetPairId = restartMatch[1];
        await redis!.publish(
          CHANNELS.control,
          JSON.stringify({ type: "RESTART", pairId: targetPairId }),
        );
        return json({ ok: true, message: `Restart command sent for ${targetPairId}` });
      }

      // ---- Pairs list ----
      if (path === "/api/pairs") {
        const ids = await pairIds();
        const pairs = [];
        for (const id of ids) {
          const db = dbFor(id);
          const state = orchestrated ? await workerState(id) : getPair(id);
          const positions = db ? getPositions(db) : [];
          const alloc = db ? getLatestPairAllocation(db) : null;
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

        // Get DB (works in both modes)
        const db = dbFor(pairId);

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

        // All remaining endpoints need the DB
        if (!db) return json({ error: "Pair not found" }, 404);

        switch (sub) {
          case "positions":
            return json(getPositions(db));

          case "allocations": {
            const limit = url.searchParams.get("limit");
            if (limit) {
              return json(getPairAllocations(db, parseInt(limit)));
            }
            return json(getLatestPairAllocation(db) ?? null);
          }

          case "snapshots": {
            const from = url.searchParams.get("from");
            const to = url.searchParams.get("to");
            const limit = url.searchParams.get("limit");
            return json(
              getEpochSnapshots(
                db,
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
                getPoolAnalyses(
                  db,
                  pool,
                  parseInt(chain),
                  from ? parseInt(from) : undefined,
                  to ? parseInt(to) : undefined,
                ),
              );
            }
            return json(getLatestAnalysesForPools(db));
          }

          case "candles": {
            const from = parseInt(
              url.searchParams.get("from") || String(Date.now() - DEFAULT_CANDLE_WINDOW_MS),
            );
            const to = parseInt(url.searchParams.get("to") || String(Date.now()));
            return json(getCandles(db, from, to));
          }

          case "txlog": {
            const limit = parseInt(url.searchParams.get("limit") || String(DEFAULT_TXLOG_LIMIT));
            return json(getTxLogs(db, limit));
          }
        }
      }

      return json({ error: "Not found" }, 404);
    },
  });

  log.info(`API server listening on http://localhost:${port}`);
  return server;
}
