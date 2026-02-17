import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import type {
  Candle,
  Position,
  PoolSnapshot,
  PoolAnalysis,
  PairAllocation,
  TxLogEntry,
  AllocationEntry,
  DecisionType,
  DexId,
} from "../types";
import type { EpochSnapshot } from "../../shared/types";
import { EPOCHS_PER_YEAR, DB_DIR, DATA_RETENTION_DAYS } from "../config/params";
import { log } from "../utils";

// DB row types for typed query results
interface SnapshotRow {
  pool: string;
  chain: number;
  ts: number;
  volume_24h: number;
  tvl: number;
  fee_pct: number;
  base_price_usd: number;
  quote_price_usd: number;
  exchange_rate: number;
  price_change_h1: number;
  price_change_h24: number;
}

interface AnalysisRow {
  pool: string;
  chain: number;
  ts: number;
  interval_volume: number;
  fee_pct: number;
  fees_generated: number;
  tvl: number;
  utilization: number;
  apr: number;
  exchange_rate: number;
  base_price_usd: number;
  vforce: number;
  mforce: number;
  tforce: number;
  range_min: number;
  range_max: number;
  range_breadth: number;
  range_bias: number;
  range_confidence: number;
}

interface PairAllocRow {
  ts: number;
  current_apr: number;
  optimal_apr: number;
  improvement: number;
  decision: string;
  target_allocations: string;
  current_allocations: string;
}

interface PositionRow {
  id: string;
  pool: string;
  chain: number;
  dex: string;
  position_id: string;
  tick_lower: number;
  tick_upper: number;
  liquidity: string;
  amount0: string;
  amount1: string;
  entry_price: number;
  entry_ts: number;
  entry_apr: number;
  entry_value_usd: number;
}

interface TxLogRow {
  id: number;
  ts: number;
  decision_type: string;
  op_type: string;
  pool: string;
  chain: number;
  tx_hash: string;
  status: string;
  gas_used: string;
  gas_price: string;
  input_token: string;
  input_amount: string;
  input_usd: number;
  output_token: string;
  output_amount: string;
  output_usd: number;
  target_allocation_pct: number;
  actual_allocation_pct: number;
  allocation_error_pct: number;
}

interface EpochSnapshotRow {
  pair_id: string;
  epoch: number;
  ts: number;
  decision: string;
  portfolio_value_usd: number;
  fees_earned_usd: number;
  gas_spent_usd: number;
  il_usd: number;
  net_pnl_usd: number;
  range_efficiency: number;
  current_apr: number;
  optimal_apr: number;
  positions_count: number;
}

/**
 * Initialize a per-pair SQLite database at .data/{pairId}.db.
 * Returns the Database handle. Creates directory and tables if needed.
 */
export function initPairStore(pairId: string, path?: string): Database {
  const dbPath = path ?? `${DB_DIR}/${pairId}.db`;
  if (dbPath !== ":memory:") {
    const dir = dbPath.substring(0, dbPath.lastIndexOf("/"));
    if (dir) mkdirSync(dir, { recursive: true });
  }
  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS m1_candles (
      ts INTEGER PRIMARY KEY,
      o REAL, h REAL, l REAL, c REAL, v REAL
    );

    CREATE TABLE IF NOT EXISTS pool_snapshots (
      pool TEXT, chain INTEGER, ts INTEGER,
      volume_24h REAL, tvl REAL, fee_pct REAL,
      base_price_usd REAL, quote_price_usd REAL, exchange_rate REAL,
      price_change_h1 REAL, price_change_h24 REAL,
      PRIMARY KEY (pool, chain, ts)
    );

    CREATE TABLE IF NOT EXISTS pool_analysis (
      pool TEXT, chain INTEGER, ts INTEGER,
      interval_volume REAL, fee_pct REAL, fees_generated REAL,
      tvl REAL, utilization REAL, apr REAL,
      exchange_rate REAL, base_price_usd REAL,
      vforce REAL, mforce REAL, tforce REAL,
      range_min REAL, range_max REAL, range_breadth REAL,
      range_bias REAL, range_confidence REAL,
      PRIMARY KEY (pool, chain, ts)
    );

    CREATE TABLE IF NOT EXISTS pair_allocation (
      ts INTEGER PRIMARY KEY,
      current_apr REAL, optimal_apr REAL, improvement REAL,
      decision TEXT,
      target_allocations TEXT, current_allocations TEXT
    );

    CREATE TABLE IF NOT EXISTS positions (
      id TEXT PRIMARY KEY, pool TEXT, chain INTEGER, dex TEXT,
      position_id TEXT, tick_lower INTEGER, tick_upper INTEGER,
      liquidity TEXT, amount0 TEXT, amount1 TEXT,
      entry_price REAL, entry_ts INTEGER, entry_apr REAL, entry_value_usd REAL
    );

    CREATE TABLE IF NOT EXISTS tx_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER, decision_type TEXT, op_type TEXT,
      pool TEXT, chain INTEGER, tx_hash TEXT, status TEXT,
      gas_used TEXT, gas_price TEXT,
      input_token TEXT, input_amount TEXT, input_usd REAL,
      output_token TEXT, output_amount TEXT, output_usd REAL,
      target_allocation_pct REAL, actual_allocation_pct REAL, allocation_error_pct REAL
    );

    CREATE TABLE IF NOT EXISTS optimizer_state (
      pair_id TEXT PRIMARY KEY,
      vec TEXT,
      fitness REAL,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS epoch_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pair_id TEXT NOT NULL,
      epoch INTEGER NOT NULL,
      ts INTEGER NOT NULL,
      decision TEXT NOT NULL,
      portfolio_value_usd REAL NOT NULL DEFAULT 0,
      fees_earned_usd REAL NOT NULL DEFAULT 0,
      gas_spent_usd REAL NOT NULL DEFAULT 0,
      il_usd REAL NOT NULL DEFAULT 0,
      net_pnl_usd REAL NOT NULL DEFAULT 0,
      range_efficiency REAL NOT NULL DEFAULT 0,
      current_apr REAL NOT NULL DEFAULT 0,
      optimal_apr REAL NOT NULL DEFAULT 0,
      positions_count INTEGER NOT NULL DEFAULT 0,
      UNIQUE(pair_id, epoch)
    );
  `);
  log.info(`Store initialized for ${pairId} at ${dbPath}`);
  return db;
}

/** Delete rows older than retentionDays from all time-series tables. */
export function pruneOldData(db: Database, retentionDays = DATA_RETENTION_DAYS) {
  const cutoff = Date.now() - retentionDays * 86_400_000;
  db.transaction(() => {
    db.prepare("DELETE FROM m1_candles WHERE ts < ?").run(cutoff);
    db.prepare("DELETE FROM pool_snapshots WHERE ts < ?").run(cutoff);
    db.prepare("DELETE FROM pool_analysis WHERE ts < ?").run(cutoff);
    db.prepare("DELETE FROM pair_allocation WHERE ts < ?").run(cutoff);
    db.prepare("DELETE FROM tx_log WHERE ts < ?").run(cutoff);
    db.prepare("DELETE FROM epoch_snapshots WHERE ts < ?").run(cutoff);
  })();
  log.info(`Pruned data older than ${retentionDays}d`);
}

type BindVal = string | number | bigint | boolean | null;

/** Transactional bulk upsert: prepare once, run in a single write transaction. */
function bulkUpsert<T>(db: Database, sql: string, items: T[], mapper: (item: T) => BindVal[]) {
  const stmt = db.prepare(sql);
  db.transaction(() => {
    for (const item of items) stmt.run(...mapper(item));
  })();
}

/** Append optional ts range filters, ORDER BY ts ASC, and optional LIMIT to a SQL query. Mutates params array. */
function appendTimeRange(
  sql: string,
  params: (string | number)[],
  opts: { fromTs?: number; toTs?: number; limit?: number },
): string {
  if (opts.fromTs !== undefined) {
    sql += ` AND ts >= ?`;
    params.push(opts.fromTs);
  }
  if (opts.toTs !== undefined) {
    sql += ` AND ts <= ?`;
    params.push(opts.toTs);
  }
  sql += ` ORDER BY ts ASC`;
  if (opts.limit !== undefined) {
    sql += ` LIMIT ?`;
    params.push(opts.limit);
  }
  return sql;
}

// ---- M1 Candles ----

export function saveCandles(db: Database, candles: Candle[]) {
  bulkUpsert(
    db,
    `INSERT OR REPLACE INTO m1_candles (ts, o, h, l, c, v) VALUES (?, ?, ?, ?, ?, ?)`,
    candles,
    (c) => [c.ts, c.o, c.h, c.l, c.c, c.v],
  );
}

export function getCandles(db: Database, fromTs: number, toTs: number): Candle[] {
  return db
    .prepare(`SELECT ts, o, h, l, c, v FROM m1_candles WHERE ts >= ? AND ts <= ? ORDER BY ts ASC`)
    .all(fromTs, toTs) as Candle[];
}

export function getLatestCandleTs(db: Database): number {
  const r = db.prepare(`SELECT MAX(ts) as ts FROM m1_candles`).get() as {
    ts: number | null;
  } | null;
  return r?.ts || 0;
}

// ---- Pool Snapshots ----

export function saveSnapshot(db: Database, s: PoolSnapshot) {
  db.prepare(
    `INSERT OR REPLACE INTO pool_snapshots (pool, chain, ts, volume_24h, tvl, fee_pct, base_price_usd, quote_price_usd, exchange_rate, price_change_h1, price_change_h24)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    s.pool,
    s.chain,
    s.ts,
    s.volume24h,
    s.tvl,
    s.feePct,
    s.basePriceUsd,
    s.quotePriceUsd,
    s.exchangeRate,
    s.priceChangeH1,
    s.priceChangeH24,
  );
}

export function getLastSnapshot(
  db: Database,
  pool: string,
  chain: number,
  beforeTs: number,
): PoolSnapshot | null {
  const row = db
    .prepare(
      `SELECT pool, chain, ts, volume_24h, tvl, fee_pct, base_price_usd, quote_price_usd, exchange_rate, price_change_h1, price_change_h24
       FROM pool_snapshots WHERE pool = ? AND chain = ? AND ts < ? ORDER BY ts DESC LIMIT 1`,
    )
    .get(pool, chain, beforeTs) as SnapshotRow | null;
  if (!row) return null;
  return {
    pool: row.pool as `0x${string}`,
    chain: row.chain,
    ts: row.ts,
    volume24h: row.volume_24h,
    tvl: row.tvl,
    feePct: row.fee_pct,
    basePriceUsd: row.base_price_usd,
    quotePriceUsd: row.quote_price_usd,
    exchangeRate: row.exchange_rate,
    priceChangeH1: row.price_change_h1,
    priceChangeH24: row.price_change_h24,
  };
}

// ---- Pool Analysis ----

function mapAnalysisRow(r: AnalysisRow): PoolAnalysis {
  return {
    pool: r.pool as `0x${string}`,
    chain: r.chain,
    ts: r.ts,
    intervalVolume: r.interval_volume,
    feePct: r.fee_pct,
    feesGenerated: r.fees_generated,
    tvl: r.tvl,
    utilization: r.utilization,
    apr: r.apr,
    exchangeRate: r.exchange_rate,
    basePriceUsd: r.base_price_usd,
    vforce: r.vforce,
    mforce: r.mforce,
    tforce: r.tforce,
    rangeMin: r.range_min,
    rangeMax: r.range_max,
    rangeBreadth: r.range_breadth,
    rangeBias: r.range_bias,
    rangeConfidence: r.range_confidence,
  };
}

export function savePoolAnalyses(db: Database, analyses: PoolAnalysis[]) {
  bulkUpsert(
    db,
    `INSERT OR REPLACE INTO pool_analysis (pool, chain, ts, interval_volume, fee_pct, fees_generated, tvl, utilization, apr, exchange_rate, base_price_usd, vforce, mforce, tforce, range_min, range_max, range_breadth, range_bias, range_confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    analyses,
    (a) => [
      a.pool,
      a.chain,
      a.ts,
      a.intervalVolume,
      a.feePct,
      a.feesGenerated,
      a.tvl,
      a.utilization,
      a.apr,
      a.exchangeRate,
      a.basePriceUsd,
      a.vforce,
      a.mforce,
      a.tforce,
      a.rangeMin,
      a.rangeMax,
      a.rangeBreadth,
      a.rangeBias,
      a.rangeConfidence,
    ],
  );
}

export function getPoolAnalyses(
  db: Database,
  pool: string,
  chain: number,
  fromTs?: number,
  toTs?: number,
): PoolAnalysis[] {
  const params: (string | number)[] = [pool, chain];
  const sql = appendTimeRange(
    `SELECT pool, chain, ts, interval_volume, fee_pct, fees_generated, tvl, utilization, apr, exchange_rate, base_price_usd, vforce, mforce, tforce, range_min, range_max, range_breadth, range_bias, range_confidence
     FROM pool_analysis WHERE pool = ? AND chain = ?`,
    params,
    { fromTs, toTs },
  );
  return (db.prepare(sql).all(...params) as AnalysisRow[]).map(mapAnalysisRow);
}

// ---- Pair Allocation ----

function mapPairAllocRow(row: PairAllocRow): PairAllocation {
  return {
    ts: row.ts,
    currentApr: row.current_apr,
    optimalApr: row.optimal_apr,
    improvement: row.improvement,
    decision: row.decision as DecisionType,
    targetAllocations: JSON.parse(row.target_allocations) as AllocationEntry[],
    currentAllocations: JSON.parse(row.current_allocations) as AllocationEntry[],
  };
}

export function savePairAllocation(db: Database, alloc: PairAllocation) {
  db.prepare(
    `INSERT OR REPLACE INTO pair_allocation (ts, current_apr, optimal_apr, improvement, decision, target_allocations, current_allocations)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    alloc.ts,
    alloc.currentApr,
    alloc.optimalApr,
    alloc.improvement,
    alloc.decision,
    JSON.stringify(alloc.targetAllocations),
    JSON.stringify(alloc.currentAllocations),
  );
}

export function getLatestPairAllocation(db: Database): PairAllocation | null {
  const row = db
    .prepare(`SELECT * FROM pair_allocation ORDER BY ts DESC LIMIT 1`)
    .get() as PairAllocRow | null;
  if (!row) return null;
  return mapPairAllocRow(row);
}

// ---- Positions ----

export function savePosition(db: Database, p: Position) {
  db.prepare(
    `INSERT OR REPLACE INTO positions (id, pool, chain, dex, position_id, tick_lower, tick_upper, liquidity, amount0, amount1, entry_price, entry_ts, entry_apr, entry_value_usd)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    p.id,
    p.pool,
    p.chain,
    p.dex,
    p.positionId,
    p.tickLower,
    p.tickUpper,
    p.liquidity.toString(),
    p.amount0.toString(),
    p.amount1.toString(),
    p.entryPrice,
    p.entryTs,
    p.entryApr,
    p.entryValueUsd,
  );
}

export function getPositions(db: Database): Position[] {
  const rows = db.prepare(`SELECT * FROM positions`).all() as PositionRow[];
  return rows.map((r) => ({
    id: r.id,
    pool: r.pool as `0x${string}`,
    chain: r.chain,
    dex: r.dex as DexId,
    positionId: r.position_id,
    tickLower: r.tick_lower,
    tickUpper: r.tick_upper,
    liquidity: BigInt(r.liquidity),
    amount0: BigInt(r.amount0),
    amount1: BigInt(r.amount1),
    entryPrice: r.entry_price,
    entryTs: r.entry_ts,
    entryApr: r.entry_apr,
    entryValueUsd: r.entry_value_usd,
  }));
}

export function deletePosition(db: Database, id: string) {
  db.prepare(`DELETE FROM positions WHERE id = ?`).run(id);
}

// ---- Tx Log ----

export function logTx(db: Database, entry: TxLogEntry) {
  db.prepare(
    `INSERT INTO tx_log (ts, decision_type, op_type, pool, chain, tx_hash, status, gas_used, gas_price, input_token, input_amount, input_usd, output_token, output_amount, output_usd, target_allocation_pct, actual_allocation_pct, allocation_error_pct)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.ts,
    entry.decisionType,
    entry.opType,
    entry.pool,
    entry.chain,
    entry.txHash,
    entry.status,
    entry.gasUsed.toString(),
    entry.gasPrice.toString(),
    entry.inputToken,
    entry.inputAmount,
    entry.inputUsd,
    entry.outputToken,
    entry.outputAmount,
    entry.outputUsd,
    entry.targetAllocationPct,
    entry.actualAllocationPct,
    entry.allocationErrorPct,
  );
}

export function getTxLogs(db: Database, limit = 50): TxLogEntry[] {
  const rows = db.prepare(`SELECT * FROM tx_log ORDER BY id DESC LIMIT ?`).all(limit) as TxLogRow[];
  return rows.map((r) => ({
    id: r.id,
    ts: r.ts,
    decisionType: r.decision_type as DecisionType,
    opType: r.op_type as TxLogEntry["opType"],
    pool: r.pool as `0x${string}`,
    chain: r.chain,
    txHash: r.tx_hash as `0x${string}`,
    status: r.status as "success" | "reverted",
    gasUsed: BigInt(r.gas_used),
    gasPrice: BigInt(r.gas_price),
    inputToken: r.input_token,
    inputAmount: r.input_amount,
    inputUsd: r.input_usd,
    outputToken: r.output_token,
    outputAmount: r.output_amount,
    outputUsd: r.output_usd,
    targetAllocationPct: r.target_allocation_pct,
    actualAllocationPct: r.actual_allocation_pct,
    allocationErrorPct: r.allocation_error_pct,
  }));
}

// ---- Optimizer State (warm-start persistence) ----

export function getOptimizerState(
  db: Database,
  pairId: string,
): { vec: number[]; fitness: number } | null {
  const row = db
    .prepare(`SELECT vec, fitness FROM optimizer_state WHERE pair_id = ?`)
    .get(pairId) as { vec: string; fitness: number } | null;
  if (!row) return null;
  return { vec: JSON.parse(row.vec) as number[], fitness: row.fitness };
}

export function saveOptimizerState(db: Database, pairId: string, vec: number[], fitness: number) {
  db.prepare(
    `INSERT OR REPLACE INTO optimizer_state (pair_id, vec, fitness, updated_at) VALUES (?, ?, ?, ?)`,
  ).run(pairId, JSON.stringify(vec), fitness, Date.now());
}

// ---- Epoch Snapshots ----

function mapEpochSnapshotRow(r: EpochSnapshotRow): EpochSnapshot {
  return {
    pairId: r.pair_id,
    epoch: r.epoch,
    ts: r.ts,
    decision: r.decision as DecisionType,
    portfolioValueUsd: r.portfolio_value_usd,
    feesEarnedUsd: r.fees_earned_usd,
    gasSpentUsd: r.gas_spent_usd,
    ilUsd: r.il_usd,
    netPnlUsd: r.net_pnl_usd,
    rangeEfficiency: r.range_efficiency,
    currentApr: r.current_apr,
    optimalApr: r.optimal_apr,
    positionsCount: r.positions_count,
  };
}

export function saveEpochSnapshot(db: Database, snapshot: EpochSnapshot) {
  db.prepare(
    `INSERT OR REPLACE INTO epoch_snapshots (pair_id, epoch, ts, decision, portfolio_value_usd, fees_earned_usd, gas_spent_usd, il_usd, net_pnl_usd, range_efficiency, current_apr, optimal_apr, positions_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    snapshot.pairId,
    snapshot.epoch,
    snapshot.ts,
    snapshot.decision,
    snapshot.portfolioValueUsd,
    snapshot.feesEarnedUsd,
    snapshot.gasSpentUsd,
    snapshot.ilUsd,
    snapshot.netPnlUsd,
    snapshot.rangeEfficiency,
    snapshot.currentApr,
    snapshot.optimalApr,
    snapshot.positionsCount,
  );
}

export function getEpochSnapshots(
  db: Database,
  pairId: string,
  fromTs?: number,
  toTs?: number,
  limit?: number,
): EpochSnapshot[] {
  const params: (string | number)[] = [pairId];
  const sql = appendTimeRange(
    `SELECT pair_id, epoch, ts, decision, portfolio_value_usd, fees_earned_usd, gas_spent_usd, il_usd, net_pnl_usd, range_efficiency, current_apr, optimal_apr, positions_count
     FROM epoch_snapshots WHERE pair_id = ?`,
    params,
    { fromTs, toTs, limit },
  );
  return (db.prepare(sql).all(...params) as EpochSnapshotRow[]).map(mapEpochSnapshotRow);
}

// ---- Pair Allocations (historical) ----

export function getPairAllocations(db: Database, limit = 50): PairAllocation[] {
  const rows = db
    .prepare(`SELECT * FROM pair_allocation ORDER BY ts DESC LIMIT ?`)
    .all(limit) as PairAllocRow[];
  return rows.map(mapPairAllocRow);
}

// ---- Dashboard queries ----

export function getLatestAnalysesForPools(db: Database): PoolAnalysis[] {
  const rows = db
    .prepare(
      `SELECT pool, chain, ts, interval_volume, fee_pct, fees_generated, tvl, utilization, apr,
            exchange_rate, base_price_usd, vforce, mforce, tforce,
            range_min, range_max, range_breadth, range_bias, range_confidence
     FROM pool_analysis WHERE ts = (SELECT MAX(ts) FROM pool_analysis)`,
    )
    .all() as AnalysisRow[];
  return rows.map(mapAnalysisRow);
}

/** Annualize a per-epoch USD cost as an APR fraction relative to portfolio value. */
function annualize(costUsd: number, portfolioValueUsd: number): number {
  return portfolioValueUsd > 0 ? (costUsd / portfolioValueUsd) * EPOCHS_PER_YEAR : 0;
}

export function getRecentYields(db: Database, limit = 24): number[] {
  // Return net yield: current_apr - optimal_apr differential gives overshoot penalty,
  // but the real net yield needs gas cost deduction. Use epoch_snapshots when available
  // (has gas_spent_usd + il_usd), fallback to pair_allocation gross APR minus gas estimate.
  const snapRows = db
    .prepare(
      `SELECT current_apr, gas_spent_usd, il_usd, portfolio_value_usd
     FROM epoch_snapshots ORDER BY ts DESC LIMIT ?`,
    )
    .all(limit) as {
    current_apr: number;
    gas_spent_usd: number;
    il_usd: number;
    portfolio_value_usd: number;
  }[];
  if (snapRows.length >= limit) {
    return snapRows
      .map((r) => {
        const gasCostApr = annualize(r.gas_spent_usd, r.portfolio_value_usd);
        const ilApr = annualize(r.il_usd, r.portfolio_value_usd);
        return r.current_apr - gasCostApr - ilApr;
      })
      .reverse();
  }
  // Fallback: gross APR (backward compatible)
  const rows = db
    .prepare(`SELECT current_apr FROM pair_allocation ORDER BY ts DESC LIMIT ?`)
    .all(limit) as { current_apr: number }[];
  return rows.map((r) => r.current_apr).reverse();
}

export function getRecentRsTimestamps(db: Database, sinceTs: number): number[] {
  const rows = db
    .prepare(`SELECT ts FROM pair_allocation WHERE decision = 'RS' AND ts > ? ORDER BY ts ASC`)
    .all(sinceTs) as { ts: number }[];
  return rows.map((r) => r.ts);
}

export function getTrailingTxCount(db: Database, sinceTs: number): number {
  const row = db.prepare(`SELECT COUNT(*) as cnt FROM tx_log WHERE ts > ?`).get(sinceTs) as {
    cnt: number;
  };
  return row.cnt;
}
