// NOTE: All "Usd" fields are denominated in USDC (our base stablecoin), not fiat USD.

// Shared types: import for local use, re-export for consumers
import type {
  ChainId,
  DecisionType,
  Forces,
  RangeParams,
  RegimeState,
  Candle,
  PoolAnalysis as SharedPoolAnalysis,
  AllocationEntry as SharedAllocationEntry,
  PairAllocation as SharedPairAllocation,
  Position as SharedPosition,
  TxLogEntry as SharedTxLogEntry,
} from "../shared/types";
export type { ChainId, DecisionType, Forces, RangeParams, RegimeState, Candle };

// ---- Chain & Network ----

export interface ChainConfig {
  id: ChainId;
  name: string;
  rpc: string;
  gecko: string; // GeckoTerminal network slug
  blockTimeMs: number;
  nativeSymbol: string;
}

// ---- DEX ----

export const DexId = {
  UNI_V3: "uni-v3",
  PCS_V3: "pcs-v3",
  AERO_V3: "aero-v3",
  PANGOLIN_V3: "pangolin-v3",
  BLACKHOLE_V3: "blackhole-v3",
  PHARAOH_V3: "pharaoh-v3",
  PROJECT_X_V3: "project-x-v3",
  RAMSES_V3: "ramses-v3",
  CAMELOT_V3: "camelot-v3",
  QUICKSWAP_V3: "quickswap-v3",
  UNI_V4: "uni-v4",
  HYBRA_V4: "hybra-v4",
  PCS_V4: "pcs-v4",
  JOE_V2: "joe-v2",
  JOE_V21: "joe-v2.1",
  JOE_V22: "joe-v2.2",
} as const;
export type DexId = (typeof DexId)[keyof typeof DexId];

export const DexFamily = {
  V3: "v3",
  ALGEBRA: "algebra",
  AERODROME: "aerodrome",
  V4: "v4",
  PCS_V4: "pcs-v4",
  LB: "lb",
} as const;
export type DexFamily = (typeof DexFamily)[keyof typeof DexFamily];

export interface PoolEntry {
  id: `0x${string}`;
  chain: ChainId;
  dex: DexId;
}

export interface PoolState {
  token0: `0x${string}`;
  token1: `0x${string}`;
  price: number; // universal — token1/token0 exchange rate
  fee: number; // decimal (0.0005 = 5bp)
  // CLMM fields (V3/V4/Algebra/Aerodrome)
  sqrtPriceX96?: bigint;
  tick?: number;
  liquidity?: bigint; // V3-style L (sqrt-liquidity)
  tickSpacing?: number;
  // LB fields (Trader Joe)
  activeId?: number;
  binStep?: number;
  reserveX?: bigint;
  reserveY?: bigint;
}

// ---- Token & Pool ----

export interface TokenConfig {
  symbol: string;
  decimals: number;
  chainDecimals?: Partial<Record<number, number>>;
  addresses: Record<ChainId, `0x${string}`>;
}

export interface PoolConfig {
  address: `0x${string}`;
  chain: ChainId;
  dex: DexId;
}

// ---- Pair ----

export interface PairConfig {
  id: string; // e.g. "USDC-USDT"
  token0: TokenConfig;
  token1: TokenConfig;
  eoaEnvVar: string; // env var name for private key
  pools: PoolConfig[];
  intervalSec: number; // default 900
  maxPositions: number; // default 3
  thresholds: { pra: number; rs: number }; // default 0.05, 0.25
  forceParams?: Partial<ForceParams>;
}

// ---- Force Model (Forces re-exported from @shared/types) ----

export interface ForceParams {
  volatility: { lookback: number; criticalForce: number };
  momentum: { lookback: number; oversoldFrom: number; overboughtFrom: number };
  trend: {
    lookback: number;
    bullishFrom: number;
    bearishFrom: number;
    biasExp: number;
    biasDivider: number;
  };
  confidence: { vforceExp: number; mforceDivider: number };
  baseRange: { min: number; max: number; vforceExp: number; vforceDivider: number };
  rsThreshold: number;
}

// ---- Range ----

export interface Range {
  min: number;
  max: number;
  base: number;
  breadth: number;
  confidence: number;
  trendBias: number;
  type: "bullish" | "bearish" | "neutral";
}

// ---- OHLC (Candle re-exported from @shared/types) ----

// ---- GeckoTerminal Pool Data ----

export interface GeckoPoolData {
  volume24h: number;
  tvl: number;
  feePct: number; // as decimal, e.g. 0.0005 for 0.05%
  basePriceUsd: number;
  quotePriceUsd: number;
  exchangeRate: number; // base_token_price_quote_token
  priceChangeH1: number;
  priceChangeH24: number;
}

// ---- Pool Snapshot (enriched GeckoTerminal data) ----

export interface PoolSnapshot extends GeckoPoolData {
  pool: `0x${string}`;
  chain: ChainId;
  ts: number;
}

// ---- Pool Analysis (computed per-pool per-cycle) ----

export type PoolAnalysis = Omit<SharedPoolAnalysis, "pool"> & { pool: `0x${string}` };

// ---- Allocation Entry ----

export type AllocationEntry = Omit<SharedAllocationEntry, "pool" | "dex"> & {
  pool: `0x${string}`;
  dex: DexId;
};

// ---- Pair Allocation (computed per-pair per-cycle) ----

export type PairAllocation = Omit<
  SharedPairAllocation,
  "targetAllocations" | "currentAllocations"
> & { targetAllocations: AllocationEntry[]; currentAllocations: AllocationEntry[] };

// ---- Position ----

export type Position = Omit<
  SharedPosition,
  "pool" | "dex" | "liquidity" | "amount0" | "amount1"
> & { pool: `0x${string}`; dex: DexId; liquidity: bigint; amount0: bigint; amount1: bigint };

export interface MintResult {
  position: Position | null;
  txHash: `0x${string}`;
  gasUsed: bigint;
  gasPrice: bigint;
}

export interface BurnResult {
  success: boolean;
  amount0: bigint;
  amount1: bigint;
  hash: `0x${string}`;
  gasUsed: bigint;
  gasPrice: bigint;
}

// ---- Decision (DecisionType re-exported from @shared/types) ----

export interface Decision {
  type: DecisionType;
  ts: number;
  currentApr: number;
  optimalApr: number;
  improvement: number;
  targetAllocations: AllocationEntry[];
  rangeShifts?: { pool: `0x${string}`; chain: ChainId; oldRange: Range; newRange: Range }[];
}

// ---- Li.Fi ----

export interface LifiQuoteParams {
  fromChain: ChainId;
  toChain: ChainId;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  fromAddress: string;
  toAddress: string;
  slippage?: number;
  integrator?: string;
}

export interface LifiQuote {
  type: string;
  transactionRequest: {
    to: string;
    data: string;
    value: string;
    gasLimit?: string;
  };
  estimate: {
    fromAmount: string;
    toAmount: string;
    toAmountMin: string;
    approvalAddress: string;
  };
  action: {
    fromChainId: number;
    toChainId: number;
    toAddress: string;
  };
}

export interface SwapResult {
  amountOut: bigint;
  sourceTxHash: `0x${string}`;
}

// ---- Tx Log Entry ----

export type TxLogEntry = Omit<
  SharedTxLogEntry,
  "id" | "pool" | "txHash" | "gasUsed" | "gasPrice"
> & { id?: number; pool: `0x${string}`; txHash: `0x${string}`; gasUsed: bigint; gasPrice: bigint };

export function findPool(pair: PairConfig, pool: `0x${string}`, chain: number): PoolConfig {
  const found = pair.pools.find((p) => p.address === pool && p.chain === chain);
  if (!found) throw new Error(`Pool not found: ${pool} on chain ${chain}`);
  return found;
}
