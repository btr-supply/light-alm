import type {
  Candle,
  PoolSnapshot,
  PoolAnalysis,
  PairAllocation,
  TxLogEntry,
  AllocationEntry,
  DecisionType,
} from "../types";
import type { EpochSnapshot } from "../../shared/types";
import { O2_FETCH_TIMEOUT_MS, EPOCHS_PER_YEAR } from "../config/params";
import { errMsg } from "../utils";

// ---- O2 SQL Query Engine ----

/** Escape a string for safe SQL interpolation (prevents injection). */
function esc(s: string): string {
  return s.replace(/'/g, "''");
}

/** Execute a SQL query against OpenObserve's search API. Returns empty array on failure. */
async function queryO2<T>(
  sql: string,
  size = 1000,
): Promise<T[]> {
  const url = process.env.O2_URL;
  const org = process.env.O2_ORG || "default";
  const token = process.env.O2_TOKEN;
  if (!url || !token) return [];

  const body = {
    query: {
      sql,
      from: 0,
      size,
      start_time: 0,
      end_time: Date.now() * 1000, // μs
    },
  };

  try {
    const res = await fetch(
      `${url.replace(/\/$/, "")}/api/${org}/_search?type=logs`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${token}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(O2_FETCH_TIMEOUT_MS),
      },
    );
    if (!res.ok) {
      console.error(`O2 query failed: ${res.status} ${res.statusText}`);
      return [];
    }
    const result = (await res.json()) as { hits: T[] };
    return result.hits ?? [];
  } catch (e) {
    console.error(`O2 query error: ${errMsg(e)}`);
    return [];
  }
}

// ---- Candles ----

export async function getCandles(
  pair: string,
  fromTs: number,
  toTs: number,
): Promise<Candle[]> {
  return queryO2<Candle>(
    `SELECT ts, o, h, l, c, v FROM candles WHERE pair = '${esc(pair)}' AND ts >= ${fromTs} AND ts <= ${toTs} ORDER BY ts ASC`,
    50000,
  );
}

// ---- Pool Snapshots ----

export async function getLastSnapshot(
  pool: string,
  chain: number,
  beforeTs: number,
): Promise<PoolSnapshot | null> {
  const rows = await queryO2<PoolSnapshot>(
    `SELECT pool, chain, ts, volume24h, tvl, feePct, basePriceUsd, quotePriceUsd, exchangeRate, priceChangeH1, priceChangeH24 FROM pool_snapshots WHERE pool = '${esc(pool)}' AND chain = ${chain} AND ts < ${beforeTs} ORDER BY ts DESC`,
    1,
  );
  return rows[0] ?? null;
}

// ---- Pool Analyses ----

export async function getPoolAnalyses(
  pool: string,
  chain: number,
  fromTs?: number,
  toTs?: number,
): Promise<PoolAnalysis[]> {
  let sql = `SELECT pool, chain, ts, intervalVolume, feePct, feesGenerated, tvl, utilization, apr, exchangeRate, basePriceUsd, vforce, mforce, tforce, rangeMin, rangeMax, rangeBreadth, rangeBias, rangeConfidence FROM pool_analyses WHERE pool = '${esc(pool)}' AND chain = ${chain}`;
  if (fromTs !== undefined) sql += ` AND ts >= ${fromTs}`;
  if (toTs !== undefined) sql += ` AND ts <= ${toTs}`;
  sql += ` ORDER BY ts ASC`;
  return queryO2<PoolAnalysis>(sql);
}

export async function getLatestAnalysesForPools(
  pairId: string,
): Promise<PoolAnalysis[]> {
  return queryO2<PoolAnalysis>(
    `SELECT pool, chain, ts, intervalVolume, feePct, feesGenerated, tvl, utilization, apr, exchangeRate, basePriceUsd, vforce, mforce, tforce, rangeMin, rangeMax, rangeBreadth, rangeBias, rangeConfidence FROM pool_analyses WHERE pairId = '${esc(pairId)}' AND ts = (SELECT MAX(ts) FROM pool_analyses WHERE pairId = '${esc(pairId)}')`,
  );
}

// ---- Pair Allocations ----

export async function getLatestPairAllocation(
  pairId: string,
): Promise<PairAllocation | null> {
  const rows = await queryO2<{
    ts: number;
    currentApr: number;
    optimalApr: number;
    improvement: number;
    decision: string;
    targetAllocations: string;
    currentAllocations: string;
  }>(
    `SELECT ts, currentApr, optimalApr, improvement, decision, targetAllocations, currentAllocations FROM pair_allocations WHERE pairId = '${esc(pairId)}' ORDER BY ts DESC`,
    1,
  );
  if (!rows.length) return null;
  return mapPairAllocRow(rows[0]);
}

export async function getPairAllocations(
  pairId: string,
  limit = 50,
): Promise<PairAllocation[]> {
  const rows = await queryO2<{
    ts: number;
    currentApr: number;
    optimalApr: number;
    improvement: number;
    decision: string;
    targetAllocations: string;
    currentAllocations: string;
  }>(
    `SELECT ts, currentApr, optimalApr, improvement, decision, targetAllocations, currentAllocations FROM pair_allocations WHERE pairId = '${esc(pairId)}' ORDER BY ts DESC`,
    limit,
  );
  return rows.map(mapPairAllocRow);
}

function parseJsonField<T>(v: unknown, fallback: T): T {
  if (typeof v !== "string") return (v ?? fallback) as T;
  try { return JSON.parse(v); } catch { return fallback; }
}

function mapPairAllocRow(r: {
  ts: number;
  currentApr: number;
  optimalApr: number;
  improvement: number;
  decision: string;
  targetAllocations: string | AllocationEntry[];
  currentAllocations: string | AllocationEntry[];
}): PairAllocation {
  return {
    ts: r.ts,
    currentApr: r.currentApr,
    optimalApr: r.optimalApr,
    improvement: r.improvement,
    decision: r.decision as DecisionType,
    targetAllocations: parseJsonField<AllocationEntry[]>(r.targetAllocations, []),
    currentAllocations: parseJsonField<AllocationEntry[]>(r.currentAllocations, []),
  };
}

// ---- Tx Log ----

export async function getTxLogs(
  pairId: string,
  limit = 50,
): Promise<TxLogEntry[]> {
  const rows = await queryO2<{
    ts: number;
    decisionType: string;
    opType: string;
    pool: string;
    chain: number;
    txHash: string;
    status: string;
    gasUsed: string;
    gasPrice: string;
    inputToken: string;
    inputAmount: string;
    inputUsd: number;
    outputToken: string;
    outputAmount: string;
    outputUsd: number;
    targetAllocationPct: number;
    actualAllocationPct: number;
    allocationErrorPct: number;
  }>(
    `SELECT ts, decisionType, opType, pool, chain, txHash, status, gasUsed, gasPrice, inputToken, inputAmount, inputUsd, outputToken, outputAmount, outputUsd, targetAllocationPct, actualAllocationPct, allocationErrorPct FROM tx_log WHERE pairId = '${esc(pairId)}' ORDER BY ts DESC`,
    limit,
  );
  return rows.map((r) => ({
    ts: r.ts,
    decisionType: r.decisionType as DecisionType,
    opType: r.opType as TxLogEntry["opType"],
    pool: r.pool as `0x${string}`,
    chain: r.chain,
    txHash: r.txHash as `0x${string}`,
    status: r.status as "success" | "reverted",
    gasUsed: BigInt(r.gasUsed),
    gasPrice: BigInt(r.gasPrice),
    inputToken: r.inputToken,
    inputAmount: r.inputAmount,
    inputUsd: r.inputUsd,
    outputToken: r.outputToken,
    outputAmount: r.outputAmount,
    outputUsd: r.outputUsd,
    targetAllocationPct: r.targetAllocationPct,
    actualAllocationPct: r.actualAllocationPct,
    allocationErrorPct: r.allocationErrorPct,
  }));
}

// ---- Epoch Snapshots ----

export async function getEpochSnapshots(
  pairId: string,
  fromTs?: number,
  toTs?: number,
  limit?: number,
): Promise<EpochSnapshot[]> {
  let sql = `SELECT pairId, epoch, ts, decision, portfolioValueUsd, feesEarnedUsd, gasSpentUsd, ilUsd, netPnlUsd, rangeEfficiency, currentApr, optimalApr, positionsCount FROM epoch_snapshots WHERE pairId = '${esc(pairId)}'`;
  if (fromTs !== undefined) sql += ` AND ts >= ${fromTs}`;
  if (toTs !== undefined) sql += ` AND ts <= ${toTs}`;
  sql += ` ORDER BY ts ASC`;
  return queryO2<EpochSnapshot>(sql, limit ?? 1000);
}

// ---- Kill-Switch Queries ----

/** Per-epoch net yield: gross APR minus annualized gas + IL costs. */
function annualize(costUsd: number, portfolioValueUsd: number): number {
  return portfolioValueUsd > 0 ? (costUsd / portfolioValueUsd) * EPOCHS_PER_YEAR : 0;
}

export async function getRecentYields(
  pairId: string,
  limit = 24,
): Promise<number[]> {
  const rows = await queryO2<{
    currentApr: number;
    gasSpentUsd: number;
    ilUsd: number;
    portfolioValueUsd: number;
  }>(
    `SELECT currentApr, gasSpentUsd, ilUsd, portfolioValueUsd FROM epoch_snapshots WHERE pairId = '${esc(pairId)}' ORDER BY ts DESC`,
    limit,
  );
  if (rows.length >= limit) {
    return rows
      .map((r) => {
        const gasCostApr = annualize(r.gasSpentUsd, r.portfolioValueUsd);
        const ilApr = annualize(r.ilUsd, r.portfolioValueUsd);
        return r.currentApr - gasCostApr - ilApr;
      })
      .reverse();
  }
  // Fallback: gross APR from pair_allocations
  const allocRows = await queryO2<{ currentApr: number }>(
    `SELECT currentApr FROM pair_allocations WHERE pairId = '${esc(pairId)}' ORDER BY ts DESC`,
    limit,
  );
  return allocRows.map((r) => r.currentApr).reverse();
}

export async function getRecentRsTimestamps(
  pairId: string,
  sinceTs: number,
): Promise<number[]> {
  const rows = await queryO2<{ ts: number }>(
    `SELECT ts FROM pair_allocations WHERE pairId = '${esc(pairId)}' AND decision = 'RS' AND ts > ${sinceTs} ORDER BY ts ASC`,
  );
  return rows.map((r) => r.ts);
}

export async function getTrailingTxCount(
  pairId: string,
  sinceTs: number,
): Promise<number> {
  const rows = await queryO2<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM tx_log WHERE pairId = '${esc(pairId)}' AND ts > ${sinceTs}`,
    1,
  );
  return rows[0]?.cnt ?? 0;
}
