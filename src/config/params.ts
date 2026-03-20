import type { ForceParams } from "../types";

// ---- Force & Strategy Parameters ----

export const DEFAULT_FORCE_PARAMS: ForceParams = {
  volatility: { lookback: 24, criticalForce: 15 },
  momentum: { lookback: 24, oversoldFrom: 40, overboughtFrom: 60 },
  trend: {
    lookback: 36,
    bullishFrom: 60,
    bearishFrom: 40,
    biasExp: 0.015,
    biasDivider: 3,
  },
  confidence: { vforceExp: -0.03, mforceDivider: 5 },
  baseRange: { min: 0.0005, max: 0.028, vforceExp: -0.4, vforceDivider: 300 },
  rsThreshold: 0.25,
};

// ---- Multi-Timeframe Forces ----

export const MTF_WEIGHTS = [0.3, 0.4, 0.3] as const;
export const RSI_PERIOD = 14;
export const TREND_SCALE = 1000;
export const VFORCE_SIGMOID_SCALE = 60;

// ---- Time Constants ----

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

// ---- Decision ----

export const MIN_HOLD_MS = 12 * HOUR_MS; // 12h minimum holding period
export const DEFAULT_PRA_THRESHOLD = 0.05; // 5% APR improvement to trigger PRA
export const DEFAULT_RS_THRESHOLD = 0.25; // 25% range divergence to trigger RS
export const DEFAULT_CYCLE_SEC = 900; // 15 min cycle interval
export const DEFAULT_MAX_POSITIONS = 3;
export const MIN_ABSOLUTE_APR_GAIN = 0.005; // 0.5% absolute floor
export const PRA_GAS_MULT = 1.5; // Gas-cost safety multiplier for PRA
export const RS_GAS_MULT = 2.0; // Gas-cost safety multiplier for RS
export const AMORTIZE_DAYS = 7; // Days to amortize gas cost over

// ---- Optimizer (Nelder-Mead) ----

export const M1_PER_HOUR = 60; // M1 candles in 1 hour

export const OPT_BOUNDS: { lo: number; hi: number }[] = [
  { lo: 0.0001, hi: 0.005 }, // baseMin
  { lo: 0.005, hi: 0.1 }, // baseMax
  { lo: -1.0, hi: -0.05 }, // vforceExp
  { lo: 50, hi: 1000 }, // vforceDivider
  { lo: 0.1, hi: 0.35 }, // rsThreshold
];

export const NM_ALPHA = 1.0; // reflection
export const NM_GAMMA = 2.0; // expansion
export const NM_RHO = 0.5; // contraction
export const NM_SIGMA = 0.5; // shrink
export const NM_MAX_EVALS = 300;
export const NM_RESTARTS = 3; // total NM runs: 1 warm-start + (N-1) random starts
export const NM_TOL = 1e-8;

// ---- Fitness Simulation ----

export const SIM_BAR_SEC = 900; // M15 bar period (simulation always receives M15 candles)
export const SIM_BARS_PER_DAY = 96; // SECONDS_PER_DAY / SIM_BAR_SEC
export const SIM_BARS_PER_YEAR = 365.25 * SIM_BARS_PER_DAY; // ~35064
export const SIM_VOL_LOOKBACK = 24; // trailing vol window in sim: 24 M15 bars = 6h
export const SIM_MIN_REBAL_GAP = 4; // minimum sim bars between range shifts
export const FITNESS_MIN_CANDLES = 20;
export const FITNESS_TRAIN_SPLIT = 0.8;
export const FITNESS_OVERFIT_RATIO = 0.8;
export const FITNESS_SWAP_FRICTION = 0.001; // base swap cost fraction
export const FEE_CONCENTRATION_CAP = 20; // max fee multiplier from LP concentration

// ---- Regime Detection ----

export const REGIME_VOL_SIGMA_MULT = 3;
export const REGIME_SUPPRESS_CYCLES = 4;
export const REGIME_DISPLACEMENT_STABLE = 0.02;
export const REGIME_DISPLACEMENT_VOLATILE = 0.1; // fallback when no vol history
export const REGIME_DISPLACEMENT_VOL_MULT = 4; // σ-multiples for vol-relative threshold
export const REGIME_DISPLACEMENT_MIN = 0.02; // 2% floor for volatile pairs
export const REGIME_VOL_WINDOW = 15; // M1 candle count for volume anomaly detection window
export const REGIME_VOLUME_ANOMALY_MULT = 5;
export const REGIME_WIDEN_FACTOR = 1.5;
export const REGIME_MIN_HOURLY_SAMPLES = 10;

// ---- Kill-Switch ----

export const KS_YIELD_WINDOW_MS = 6 * HOUR_MS; // kill-switch yield lookback (time-based)
export const KS_RS_WINDOW_MS = 4 * HOUR_MS; // 4h trailing window
export const KS_MAX_RS_COUNT = 8;
export const KS_PATHOLOGICAL_MIN = 0.001;
export const KS_GAS_BUDGET_PCT = 0.05; // 5% of position value

// ---- Allocation ----

export const ALLOC_MIN_PCT = 0.001;

// ---- Execution Cost Estimates ----

export const DEFAULT_CAPITAL_USD = 10_000;
export const CASH_RESERVE_PCT = 0.05;
export const IMBALANCE_THRESHOLD = 0.05;

// ---- M1 Candle Constants ----

export const TF = "1m";
export const TF_MS = 60_000;
export const SECONDS_PER_YEAR = 365.25 * 24 * 3600;
export const SECONDS_PER_DAY = DAY_MS / 1000;

// ---- Data Buffer ----

export const OPT_LOOKBACK_DAYS = 60; // optimizer training window (~2 months)
export const OPT_LOOKBACK_MS = OPT_LOOKBACK_DAYS * DAY_MS;
export const CANDLE_BUFFER_DAYS = OPT_LOOKBACK_DAYS + 14; // total M1 data in memory
export const CANDLE_BUFFER_MS = CANDLE_BUFFER_DAYS * DAY_MS;

// ---- Aggregation Periods ----

export const M15_MS = 900_000; // 15-min aggregation period
export const H1_MS = 3_600_000; // 1-hour aggregation period
export const H4_MS = 14_400_000; // 4-hour aggregation period
export const DEFAULT_FEE = 0.0005; // 5bp fallback when on-chain fee read fails

// Candle counts per timeframe for force lookbacks
export const MTF_CANDLES = {
  m15: 96, // 24h of M15
  h1: 168, // 7d of H1
  h4: 180, // 30d of H4
} as const;

// ---- OHLC Fetching ----

export const OHLC_FETCH_LIMIT = 500;
export const OHLC_MAX_ITERATIONS = 200;
export const OHLC_LATEST_LOOKBACK_CANDLES = 20;
export const EXCHANGE_RATE_LIMIT_MS = 200;

// ---- GeckoTerminal ----

export const GECKO_API_BASE = "https://api.geckoterminal.com/api/v2";
export const GECKO_RATE_LIMIT_MS = 2000;

// ---- TX Execution ----

export const TX_DEADLINE_SEC = 600;
export const DEFAULT_SLIPPAGE_BPS = 50;
export const BPS_DIVISOR = 10000n;
export const GAS_BUFFER_NUM = 120n;
export const GAS_BUFFER_DEN = 100n;
export const TX_RECEIPT_TIMEOUT_MS = 120_000;
export const PERMIT2_EXPIRY_SEC = SECONDS_PER_DAY * 30; // 30 days

export const txDeadline = () => BigInt(Math.floor(Date.now() / 1000) + TX_DEADLINE_SEC);

// ---- Addresses ----

export const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as `0x${string}`;
export const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as `0x${string}`;
export const LIFI_DIAMOND = "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE" as `0x${string}`;

// ---- BigInt Constants ----

export const MAX_UINT128 = (1n << 128n) - 1n;
export const MAX_UINT160 = (1n << 160n) - 1n;
export const Q96 = 1n << 96n;
export const E18 = 10n ** 18n;

// ---- Swap / Bridge (Li.Fi / Jumper) ----

export const LIFI_API = "https://li.quest/v1";
export const JUMPER_API = "https://api.jumper.xyz/pipeline/v1/advanced";
export const JUMPER_RATE_LIMIT_MS = 5000;
export const LIFI_RATE_LIMIT_MS = 2000;
export const SWAP_MAX_PRICE_IMPACT = 0.4;
export const SWAP_DEFAULT_SLIPPAGE = 0.005;
export const BRIDGE_TIMEOUT_MS = 10 * 60 * 1000;
export const BRIDGE_THRESHOLD = 0.01;
export const LIFI_SDK_VERSION = "3.15.4";
export const LIFI_WIDGET_VERSION = "3.40.4";
export const LIFI_INTEGRATOR = "jumper.exchange";
export const DEFAULT_INTEGRATOR = "btr";

// ---- LB (Trader Joe) Protocol ----

export const LB_BIN_ID_OFFSET = 8388608; // 2^23
export const LB_DEFAULT_BIN_RANGE = 5; // +/-5 bins around active
export const LB_ID_SLIPPAGE = 5n; // +/-5 bin drift allowance
export const LB_BIN_STEP_DIVISOR = 10000;

// ---- V4 Protocol (Uniswap / PancakeSwap) ----

export const V4_MINT_POSITION = 0x02;
export const V4_BURN_POSITION = 0x03;
export const V4_SETTLE_PAIR = 0x0d;
export const V4_TAKE_PAIR = 0x11;
export const V4_MAX_TICK = 887272;

// ---- Fee Precision ----

export const FEE_PRECISION = 1_000_000;

// ---- Catch-Up ----

export const CATCHUP_MAX_MS = 7 * DAY_MS; // max strategy catch-up window

// ---- Orchestrator / Worker ----

export const ORCHESTRATOR_LOCK_TTL = 30_000;
export const HEALTH_CHECK_INTERVAL = 10_000;
export const HEARTBEAT_TIMEOUT = 30_000;
export const WORKER_LOCK_TTL = 900_000; // 15 min — must exceed longest op (bridge: 10min + tx: 2min)
export const WORKER_HEARTBEAT_INTERVAL = 15_000;
export const WORKER_HEARTBEAT_TTL = 45_000; // 3x heartbeat interval for one-miss tolerance
export const WORKER_STATE_TTL_MS = 60_000; // Auto-expire stale worker state
export const SHUTDOWN_GRACE_MS = 30_000;
export const COLLECTOR_DATA_TTL_MS = HOUR_MS; // 1 hour — outlasts any collection interval
export const SUBSCRIBER_RECONNECT_MS = 15_000;
export const RESTARTING_KEY_TTL_MS = 60_000;
export const COLLECTOR_STARTUP_DELAY_MS = 2000;
export const MAX_RESPAWN_BACKOFF_MS = 300_000;
export const MAX_FAIL_COUNT = 20;

// ---- API ----

export const DEFAULT_API_PORT = 40042;
export const DEFAULT_CANDLE_WINDOW_MS = 24 * HOUR_MS;
export const DEFAULT_TXLOG_LIMIT = 50;

// ---- API Validation ----

/** Matches 0x-prefixed 20-byte (40 hex) addresses and V4 32-byte (64 hex) pool IDs */
export const POOL_ADDRESS_RE = /^0x[0-9a-fA-F]{40}([0-9a-fA-F]{24})?$/;
export const INTERVAL_SEC_RANGE = { min: 60, max: 86400 } as const;
export const MAX_POSITIONS_RANGE = { min: 1, max: 20 } as const;

// ---- Infrastructure ----

export const DEFAULT_REDIS_URL = "redis://localhost:6379";
export const O2_FLUSH_INTERVAL_MS = 5000;
export const O2_BUFFER_SIZE = 100;
export const O2_FETCH_TIMEOUT_MS = 10_000;
export const O2_MAX_BUFFER_PER_STREAM = 10_000;
export const FETCH_TIMEOUT_MS = 30_000;

// ---- Retry Defaults ----

export const RETRY = {
  default: { count: 3, backoffMs: 2000 },
  burn: { count: 1, backoffMs: 3000 },
  mint: { count: 1, backoffMs: 5000 },
} as const;


// ---- Executor (Fallback Range) ----

export const FALLBACK_RANGE_MIN_FACTOR = 0.99;
export const FALLBACK_RANGE_MAX_FACTOR = 1.01;
export const FALLBACK_RANGE_BREADTH = 0.02;
export const FALLBACK_RANGE_CONFIDENCE = 50;

// ---- OHLC Source Configs ----

export const OHLC_SOURCES: Record<string, { exchange: string; symbol: string; weight: number }[]> =
  {
    "USDC-USDT": [
      { exchange: "binance", symbol: "USDC/USDT", weight: 0.4 },
      { exchange: "bybit", symbol: "USDC/USDT", weight: 0.25 },
      { exchange: "okx", symbol: "USDC/USDT", weight: 0.2 },
      { exchange: "mexc", symbol: "USDC/USDT", weight: 0.15 },
    ],
    "WETH-USDC": [
      { exchange: "binance", symbol: "ETH/USDT", weight: 0.4 },
      { exchange: "bybit", symbol: "ETH/USDT", weight: 0.25 },
      { exchange: "okx", symbol: "ETH/USDT", weight: 0.2 },
      { exchange: "gate", symbol: "ETH/USDT", weight: 0.15 },
    ],
    "WBTC-USDC": [
      { exchange: "binance", symbol: "BTC/USDT", weight: 0.4 },
      { exchange: "bybit", symbol: "BTC/USDT", weight: 0.25 },
      { exchange: "okx", symbol: "BTC/USDT", weight: 0.2 },
      { exchange: "bitget", symbol: "BTC/USDT", weight: 0.15 },
    ],
  };

// Stablecoin token symbols (used for regime detection thresholds)
export const STABLE_TOKENS = ["USDC", "USDT", "DAI", "FRAX", "LUSD", "TUSD", "BUSD"] as const;
