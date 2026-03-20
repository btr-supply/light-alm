// Shared types between backend and dashboard.
// Types here use the "wire format" — bigints are strings, hex addresses are plain strings.
// The backend keeps its own internal types (with bigint/0x) in src/types.ts.

// ---- Primitives ----

export type ChainId = number;
export type DecisionType = "PRA" | "RS" | "HOLD";

// ---- Force Model ----

export interface Forces {
  v: { force: number; mean: number; std: number };
  m: { force: number; up: number; down: number };
  t: { ma0: number; ma1: number; force: number };
}

// ---- Optimizer ----

export interface RangeParams {
  baseMin: number;
  baseMax: number;
  vforceExp: number;
  vforceDivider: number;
  rsThreshold: number;
}

export interface RegimeState {
  suppressed: boolean;
  reason: string;
  widenFactor: number;
  suppressUntilEpoch: number;
}

// ---- OHLC ----

export interface Candle {
  ts: number; // unix ms
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

// ---- Wire-format API types (bigints serialized as strings) ----

export interface AllocationEntry {
  pool: string;
  chain: ChainId;
  dex: string;
  pct: number; // 0-1
  expectedApr: number;
}

export interface PairAllocation {
  ts: number;
  currentApr: number;
  optimalApr: number;
  improvement: number;
  decision: DecisionType;
  targetAllocations: AllocationEntry[];
  currentAllocations: AllocationEntry[];
}

export interface PoolAnalysis {
  pool: string;
  chain: ChainId;
  ts: number;
  intervalVolume: number;
  feePct: number;
  feesGenerated: number;
  tvl: number;
  utilization: number;
  apr: number;
  exchangeRate: number;
  basePriceUsd: number;
  vforce: number;
  mforce: number;
  tforce: number;
  rangeMin: number;
  rangeMax: number;
  rangeBreadth: number;
  rangeBias: number;
  rangeConfidence: number;
}

export interface Position {
  id: string;
  pool: string;
  chain: ChainId;
  dex: string;
  positionId: string;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  amount0: string;
  amount1: string;
  entryPrice: number;
  entryTs: number;
  entryApr: number;
  entryValueUsd: number;
}

export interface TxLogEntry {
  id?: number;
  ts: number;
  decisionType: DecisionType;
  opType: "burn" | "mint" | "swap";
  pool: string;
  chain: ChainId;
  txHash: string;
  status: "success" | "reverted";
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
}

// ---- Epoch Snapshot ----

export interface EpochSnapshot {
  pairId: string;
  epoch: number;
  ts: number;
  decision: DecisionType;
  portfolioValueUsd: number;
  feesEarnedUsd: number;
  gasSpentUsd: number;
  ilUsd: number;
  netPnlUsd: number;
  rangeEfficiency: number;
  currentApr: number;
  optimalApr: number;
  positionsCount: number;
}

// ---- Config wire types (shared between backend and dashboard) ----

export interface PairConfigEntry {
  id: string;
  pools: { chain: number; address: string; dex: string }[];
  intervalSec: number;
  maxPositions: number;
  thresholds: { pra: number; rs: number };
  forceParams?: Record<string, unknown>;
}

export interface StrategyConfigEntry {
  name: string;
  pairId: string;
  pkEnvVar: string;
  pools: { chain: number; address: string; dex: string }[];
  intervalSec: number;
  maxPositions: number;
  thresholds: { pra: number; rs: number };
  forceParams?: Record<string, unknown>;
  gasReserves?: Record<number, number>;
  allocationPct?: number;
  rpcOverrides?: Record<number, string[]>;
}

export interface DexMetadata {
  id: string;
  name: string;
  ammType: string;
  poolTypes: string[];
  landingUrl?: string;
  twitterUrl?: string;
}

// ---- Dashboard compound types ----

export interface StrategySummary {
  name: string;
  pairId: string;
  status: string;
  tvlUsd: number;
  apy: number;
  positions: number;
  decision: DecisionType;
  decisionTs: number;
  epoch: number;
}

export interface PairStatus {
  id: string;
  epoch: number;
  decision: DecisionType;
  decisionTs: number;
  forces: Forces | null;
  optimizer: { params: RangeParams; fitness: number };
  regime: RegimeState | null;
  killSwitch: { active: boolean; reason: string } | null;
}

export interface StrategyStatus extends PairStatus {
  name: string;
  pairId: string;
  status: string;
  currentApr: number;
  optimalApr: number;
}

export interface ClusterWorker {
  id: string;
  workerType: "collector" | "strategy";
  status: string;
  pid: number;
  uptimeMs: number;
  alive: boolean;
  errorMsg?: string;
}

export interface ClusterOverview {
  workers: number;
  uptime: number;
  collectors: ClusterWorker[];
  strategies: ClusterWorker[];
}

export interface OptimalRange {
  pool: string;
  chain: ChainId;
  rangeMin: number;
  rangeMax: number;
  confidence: number;
  ts: number;
}
