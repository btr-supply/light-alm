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

// ---- Decision ----

export const MIN_HOLD_MS = 12 * 3600_000; // 12h minimum holding period

// ---- Optimizer (Nelder-Mead) ----

export const CANDLES_1H = 60; // M1 candles in 1 hour
export const TRAILING_EPOCHS = 24; // 6h of 15min epochs
export const EPOCH_SEC = 900; // 15 min

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
export const NM_TOL = 1e-8;

// ---- Fitness Simulation ----

export const FITNESS_MIN_CANDLES = 20;
export const FITNESS_TRAIN_SPLIT = 0.8;
export const FITNESS_OVERFIT_RATIO = 0.8;
export const FITNESS_MIN_RS_GAP = 4; // minimum epochs between range shifts
export const FITNESS_SWAP_FRICTION = 0.001; // base swap cost fraction

// ---- Regime Detection ----

export const REGIME_VOL_SIGMA_MULT = 3;
export const REGIME_SUPPRESS_EPOCHS = 4;
export const REGIME_DISPLACEMENT_STABLE = 0.02;
export const REGIME_DISPLACEMENT_VOLATILE = 0.1;
export const REGIME_EPOCH_CANDLES = 15; // M1 candles per epoch (15min)
export const REGIME_VOLUME_ANOMALY_MULT = 5;
export const REGIME_WIDEN_FACTOR = 1.5;
export const REGIME_MIN_HOURLY_SAMPLES = 10;

// ---- Kill-Switch ----

export const KS_RS_WINDOW_MS = 4 * 3600_000; // 4h trailing window
export const KS_MAX_RS_COUNT = 8;
export const KS_PATHOLOGICAL_MIN = 0.001;
export const KS_PATHOLOGICAL_MAX = 0.002;
export const KS_GAS_BUDGET_PCT = 0.05; // 5% of position value

// ---- Allocation (Water-Fill) ----

export const BISECT_MAX_ITERS = 64;
export const BISECT_LO = 0.0001;
export const BISECT_CONVERGENCE_TOL = 1e-10;
export const ALLOC_MIN_PCT = 0.001;

// ---- Execution Cost Estimates ----

export { GAS_COST_USD } from "../../shared/format";
export const POSITION_VALUE_USD = 10_000;
export const IMBALANCE_THRESHOLD = 0.05;

// ---- M1 Candle Constants ----

export const TF = "1m";
export const TF_MS = 60_000;
export const BACKFILL_DAYS = 30;
export const BACKFILL_MS = BACKFILL_DAYS * 24 * 60 * 60 * 1000;
export const SECONDS_PER_YEAR = 365.25 * 24 * 3600;
export const SECONDS_PER_DAY = 86400;
export const DEFAULT_FEE = 0.0005; // 5bp fallback when on-chain fee read fails

// Candle counts per timeframe for force lookbacks
export const MTF_CANDLES = {
  m15: 96, // 24h of M15
  h1: 168, // 7d of H1
  h4: 180, // 30d of H4
} as const;

// ---- OHLC Fetching ----

export const OHLC_FETCH_LIMIT = 500;
export const OHLC_MAX_ITERATIONS = 100;
export const OHLC_LATEST_LOOKBACK_CANDLES = 20;

// ---- GeckoTerminal ----

export const GECKO_API_BASE = "https://api.geckoterminal.com/api/v2";
export const GECKO_RATE_LIMIT_MS = 2000;

// ---- Store / Epochs ----

export const EPOCHS_PER_DAY = 96;
export const EPOCHS_PER_YEAR = 365.25 * EPOCHS_PER_DAY;
export const DB_DIR = ".data";

// ---- TX Execution ----

export const TX_DEADLINE_SEC = 600;
export const DEFAULT_SLIPPAGE_BPS = 50;
export const BPS_DIVISOR = 10000n;
export const GAS_BUFFER_NUM = 120n;
export const GAS_BUFFER_DEN = 100n;
export const TX_RECEIPT_TIMEOUT_MS = 120_000;
export const PERMIT2_EXPIRY_SEC = 86400 * 30; // 30 days

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

// ---- Orchestrator / Worker ----

export const ORCHESTRATOR_LOCK_TTL = 30_000;
export const HEALTH_CHECK_INTERVAL = 10_000;
export const HEARTBEAT_TIMEOUT = 30_000;
export const WORKER_LOCK_TTL = 900_000; // 15 min — must exceed longest op (bridge: 10min + tx: 2min)
export const WORKER_HEARTBEAT_INTERVAL = 15_000;
export const WORKER_HEARTBEAT_TTL = 45_000; // 3x heartbeat interval for one-miss tolerance
export const WORKER_STATE_TTL_MS = 60_000; // Auto-expire stale worker state
export const SHUTDOWN_GRACE_MS = 30_000;

// ---- API ----

export const DEFAULT_API_PORT = 3001;
export const DEFAULT_CANDLE_WINDOW_MS = 24 * 3600_000;
export const DEFAULT_TXLOG_LIMIT = 50;

// ---- Infrastructure ----

export const DATA_RETENTION_DAYS = 90;

export const DEFAULT_REDIS_URL = "redis://localhost:6379";
export const O2_FLUSH_INTERVAL_MS = 5000;
export const O2_BUFFER_SIZE = 100;
export const O2_FETCH_TIMEOUT_MS = 10_000;
export const O2_MAX_BUFFER_PER_STREAM = 10_000;
export const FETCH_TIMEOUT_MS = 30_000;

// ---- Retry Defaults ----

export const DEFAULT_RETRY_COUNT = 3;
export const DEFAULT_RETRY_BACKOFF_MS = 2000;
export const MINT_RETRY_COUNT = 1;
export const MINT_RETRY_BACKOFF_MS = 5000;

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
