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
import { O2_FETCH_TIMEOUT_MS, SECONDS_PER_YEAR } from "../config/params";
import { errMsg } from "../../shared/format";

// ---- O2 Column Remapping ----
// OpenObserve lowercases all column names during ingestion.
// This map converts them back to camelCase for TypeScript consumption.

const O2_REMAP: Record<string, string> = {
  feepct: "feePct",
  basepriceusd: "basePriceUsd",
  quotepriceusd: "quotePriceUsd",
  exchangerate: "exchangeRate",
  pricechangeh1: "priceChangeH1",
  pricechangeh24: "priceChangeH24",
  intervalvolume: "intervalVolume",
  feesgenerated: "feesGenerated",
  rangemin: "rangeMin",
  rangemax: "rangeMax",
  rangebreadth: "rangeBreadth",
  rangebias: "rangeBias",
  rangeconfidence: "rangeConfidence",
  pairid: "pairId",
  currentapr: "currentApr",
  optimalapr: "optimalApr",
  targetallocations: "targetAllocations",
  currentallocations: "currentAllocations",
  portfoliovalueusd: "portfolioValueUsd",
  feesearnedusd: "feesEarnedUsd",
  gasspentusd: "gasSpentUsd",
  ilusd: "ilUsd",
  netpnlusd: "netPnlUsd",
  rangeefficiency: "rangeEfficiency",
  positionscount: "positionsCount",
  strategyname: "strategyName",
  decisiontype: "decisionType",
  optype: "opType",
  txhash: "txHash",
  gasused: "gasUsed",
  gasprice: "gasPrice",
  inputtoken: "inputToken",
  inputamount: "inputAmount",
  inputusd: "inputUsd",
  outputtoken: "outputToken",
  outputamount: "outputAmount",
  outputusd: "outputUsd",
  targetallocationpct: "targetAllocationPct",
  actualallocationpct: "actualAllocationPct",
  allocationerrorpct: "allocationErrorPct",
  volume24h: "volume24h",
};

// ---- O2 SQL Query Engine ----

function esc(s: string): string {
  return s.replace(/'/g, "''");
}

/** Query window in microseconds — 1 year to avoid O2 partition scan gaps at intermediate ranges */
const QUERY_WINDOW_US = 365 * 86_400_000 * 1000;

async function queryO2<T>(sql: string, size = 1000): Promise<T[]> {
  const url = process.env.O2_URL;
  const org = process.env.O2_ORG || "default";
  const token = process.env.O2_TOKEN;
  if (!url || !token) return [];

  const now = Date.now() * 1000; // μs
  const body = {
    query: {
      sql,
      from: 0,
      size,
      start_time: now - QUERY_WINDOW_US,
      end_time: now,
    },
  };

  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/api/${org}/_search?type=logs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${token}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(O2_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`O2 query failed: ${res.status} ${res.statusText}`);
      return [];
    }
    const result = (await res.json()) as { hits: Record<string, unknown>[] };
    const hits = result.hits ?? [];
    if (!hits.length) return [];
    return hits.map((row) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) {
        out[O2_REMAP[k] ?? k] = v;
      }
      return out as T;
    });
  } catch (e) {
    console.error(`O2 query error: ${errMsg(e)}`);
    return [];
  }
}

// ---- Candles ----

export async function getCandles(pair: string, fromTs: number, toTs: number): Promise<Candle[]> {
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
    `SELECT pool, chain, ts, volume24h, tvl, feepct, basepriceusd, quotepriceusd, exchangerate, pricechangeh1, pricechangeh24 FROM pool_snapshots WHERE pool = '${esc(pool)}' AND chain = ${chain} AND ts < ${beforeTs} ORDER BY ts DESC`,
    1,
  );
  return rows[0] ?? null;
}

// ---- Pool Analyses ----

const POOL_ANALYSIS_COLS =
  "pool, chain, ts, intervalvolume, feepct, feesgenerated, tvl, utilization, apr, exchangerate, basepriceusd, vforce, mforce, tforce, rangemin, rangemax, rangebreadth, rangebias, rangeconfidence";

export async function getPoolAnalyses(
  pool: string,
  chain: number,
  fromTs?: number,
  toTs?: number,
): Promise<PoolAnalysis[]> {
  let sql = `SELECT ${POOL_ANALYSIS_COLS} FROM pool_analyses WHERE pool = '${esc(pool)}' AND chain = ${chain}`;
  if (fromTs !== undefined) sql += ` AND ts >= ${fromTs}`;
  if (toTs !== undefined) sql += ` AND ts <= ${toTs}`;
  sql += ` ORDER BY ts ASC`;
  return queryO2<PoolAnalysis>(sql);
}

export async function getPoolAnalysesByPair(
  pairId: string,
  fromTs: number,
  toTs: number,
): Promise<PoolAnalysis[]> {
  return queryO2<PoolAnalysis>(
    `SELECT ${POOL_ANALYSIS_COLS}, pairid FROM pool_analyses WHERE pairid = '${esc(pairId)}' AND ts >= ${fromTs} AND ts <= ${toTs} ORDER BY ts ASC`,
    5000,
  );
}

export async function getLatestAnalysesForPools(pairId: string): Promise<PoolAnalysis[]> {
  return queryO2<PoolAnalysis>(
    `SELECT ${POOL_ANALYSIS_COLS} FROM pool_analyses WHERE pairid = '${esc(pairId)}' AND ts = (SELECT MAX(ts) FROM pool_analyses WHERE pairid = '${esc(pairId)}')`,
  );
}

// ---- Pair Allocations ----

const PAIR_ALLOC_COLS =
  "ts, currentapr, optimalapr, improvement, decision, targetallocations, currentallocations";

export async function getLatestPairAllocation(pairId: string): Promise<PairAllocation | null> {
  const rows = await queryO2<{
    ts: number;
    currentApr: number;
    optimalApr: number;
    improvement: number;
    decision: string;
    targetAllocations: string;
    currentAllocations: string;
  }>(
    `SELECT ${PAIR_ALLOC_COLS} FROM pair_allocations WHERE pairid = '${esc(pairId)}' ORDER BY ts DESC`,
    1,
  );
  if (!rows.length) return null;
  return mapPairAllocRow(rows[0]);
}

export async function getPairAllocations(pairId: string, limit = 50): Promise<PairAllocation[]> {
  const rows = await queryO2<{
    ts: number;
    currentApr: number;
    optimalApr: number;
    improvement: number;
    decision: string;
    targetAllocations: string;
    currentAllocations: string;
  }>(
    `SELECT ${PAIR_ALLOC_COLS} FROM pair_allocations WHERE pairid = '${esc(pairId)}' ORDER BY ts DESC`,
    limit,
  );
  return rows.map(mapPairAllocRow);
}

function parseJsonField<T>(v: unknown, fallback: T): T {
  if (typeof v !== "string") return (v ?? fallback) as T;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
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

export async function getTxLogs(pairId: string, limit = 50): Promise<TxLogEntry[]> {
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
    `SELECT ts, decisiontype, optype, pool, chain, txhash, status, gasused, gasprice, inputtoken, inputamount, inputusd, outputtoken, outputamount, outputusd, targetallocationpct, actualallocationpct, allocationerrorpct FROM tx_log WHERE pairid = '${esc(pairId)}' ORDER BY ts DESC`,
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
  let sql = `SELECT pairid, epoch, ts, decision, portfoliovalueusd, feesearnedusd, gasspentusd, ilusd, netpnlusd, rangeefficiency, currentapr, optimalapr, positionscount FROM epoch_snapshots WHERE pairid = '${esc(pairId)}'`;
  if (fromTs !== undefined) sql += ` AND ts >= ${fromTs}`;
  if (toTs !== undefined) sql += ` AND ts <= ${toTs}`;
  sql += ` ORDER BY ts ASC`;
  return queryO2<EpochSnapshot>(sql, limit ?? 1000);
}

// ---- Kill-Switch Queries ----

function annualize(costUsd: number, portfolioValueUsd: number, cycleSec: number): number {
  const intervalsPerYear = SECONDS_PER_YEAR / cycleSec;
  return portfolioValueUsd > 0 ? (costUsd / portfolioValueUsd) * intervalsPerYear : 0;
}

export async function getRecentYields(pairId: string, limit = 24, cycleSec = 900): Promise<number[]> {
  const rows = await queryO2<{
    currentApr: number;
    gasSpentUsd: number;
    ilUsd: number;
    portfolioValueUsd: number;
  }>(
    `SELECT currentapr, gasspentusd, ilusd, portfoliovalueusd FROM epoch_snapshots WHERE pairid = '${esc(pairId)}' ORDER BY ts DESC`,
    limit,
  );
  if (rows.length >= limit) {
    return rows
      .map((r) => {
        const gasCostApr = annualize(r.gasSpentUsd, r.portfolioValueUsd, cycleSec);
        const ilApr = annualize(r.ilUsd, r.portfolioValueUsd, cycleSec);
        return r.currentApr - gasCostApr - ilApr;
      })
      .reverse();
  }
  const allocRows = await queryO2<{ currentApr: number }>(
    `SELECT currentapr FROM pair_allocations WHERE pairid = '${esc(pairId)}' ORDER BY ts DESC`,
    limit,
  );
  return allocRows.map((r) => r.currentApr).reverse();
}

export async function getRecentRsTimestamps(pairId: string, sinceTs: number): Promise<number[]> {
  const rows = await queryO2<{ ts: number }>(
    `SELECT ts FROM pair_allocations WHERE pairid = '${esc(pairId)}' AND decision = 'RS' AND ts > ${sinceTs} ORDER BY ts ASC`,
  );
  return rows.map((r) => r.ts);
}

export async function getTrailingTxCount(pairId: string, sinceTs: number): Promise<number> {
  const rows = await queryO2<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM tx_log WHERE pairid = '${esc(pairId)}' AND ts > ${sinceTs}`,
    1,
  );
  return rows[0]?.cnt ?? 0;
}
