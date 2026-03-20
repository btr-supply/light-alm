import type { Forces, Candle, Position, AllocationEntry, PoolSnapshot } from "../src/types";
import { log } from "../src/utils";

/** Suppress log output for tests. Call in beforeAll. */
export function silenceLog() {
  log.setLevel("error");
}

/** Create neutral forces, optionally override v/m/t. */
export function neutralForces(v = 0, m = 50, t = 50): Forces {
  return {
    v: { force: v, mean: 0, std: 0 },
    m: { force: m, up: 0, down: 0 },
    t: { ma0: 0, ma1: 0, force: t },
  };
}

/** Generate candles from explicit close values (forces/range tests). */
export function synthFromCloses(closes: number[], base = 1.0): Candle[] {
  return closes.map((c, i) => ({
    ts: Date.now() - (closes.length - i) * 60_000,
    o: base,
    h: Math.max(base, c) + 0.001,
    l: Math.min(base, c) - 0.001,
    c,
    v: 100,
  }));
}

/** Generate candles with explicit high/low spread (Parkinson volatility tests). */
export function synthHL(count: number, hl: number, base = 1.0): Candle[] {
  return Array.from({ length: count }, (_, i) => ({
    ts: Date.now() - (count - i) * 60_000,
    o: base,
    h: base + hl / 2,
    l: base - hl / 2,
    c: base,
    v: 100,
  }));
}

/** Simple Mulberry32 PRNG: deterministic, seedable, [0, 1) output. */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Generate random-walk candles (optimizer tests). */
export function synthRandomWalk(count: number, base = 1.0, vol = 0.002, seed?: number): Candle[] {
  const rng = seed != null ? mulberry32(seed) : Math.random;
  // When seeded, use a fixed epoch aligned to M15 boundaries for deterministic aggregation.
  // When unseeded, use current time for backwards compatibility.
  const epoch = seed != null ? 1_700_000_000_000 : Date.now();
  let price = base;
  return Array.from({ length: count }, (_, i) => {
    const move = (rng() - 0.5) * 2 * vol;
    price += move;
    return {
      ts: epoch - (count - i) * 60_000,
      o: price - move / 2,
      h: price + Math.abs(move),
      l: price - Math.abs(move),
      c: price,
      v: 1000 + rng() * 500,
    };
  });
}

/** Generate flat candles at a fixed price with controlled H-L spread. */
export function synthFlat(count: number, price = 1.0, spread = 0.0002): Candle[] {
  return Array.from({ length: count }, (_, i) => ({
    ts: Date.now() - (count - i) * 60_000,
    o: price,
    h: price + spread / 2,
    l: price - spread / 2,
    c: price,
    v: 1000,
  }));
}

/** Generate candles with a linear trend from `start` to `end`, with controlled H-L spread. */
export function synthTrend(count: number, start: number, end: number, spread = 0.002): Candle[] {
  return Array.from({ length: count }, (_, i) => {
    const c = start + ((end - start) * i) / (count - 1);
    return {
      ts: Date.now() - (count - i) * 60_000,
      o: i > 0 ? start + ((end - start) * (i - 1)) / (count - 1) : c,
      h: c + spread / 2,
      l: c - spread / 2,
      c,
      v: 1000,
    };
  });
}

/** Generate sinusoidal oscillation candles (deterministic, good for RS trigger tests). */
export function synthOscillation(count: number, base = 1.0, amplitude = 0.03, period = 20): Candle[] {
  return Array.from({ length: count }, (_, i) => {
    const c = base + amplitude * Math.sin((2 * Math.PI * i) / period);
    const spread = amplitude * 0.2;
    return {
      ts: Date.now() - (count - i) * 60_000,
      o: base + amplitude * Math.sin((2 * Math.PI * (i - 0.5)) / period),
      h: c + spread,
      l: c - spread,
      c,
      v: 1000,
    };
  });
}

const ZERO_POOL = "0x0000000000000000000000000000000000000001" as `0x${string}`;

/** Create a test position with sensible defaults, override any field. */
export function makePosition(overrides?: Partial<Position>): Position {
  return {
    id: "test-pos-1",
    pool: ZERO_POOL,
    chain: 1,
    dex: "uniswap_v3",
    positionId: "42",
    tickLower: -100,
    tickUpper: 100,
    liquidity: 5000n,
    amount0: 2500n,
    amount1: 2500n,
    entryPrice: 1.0,
    entryTs: Date.now() - 24 * 3600_000,
    entryApr: 0.15,
    entryValueUsd: 5000,
    ...overrides,
  };
}

/** Create a test allocation entry with sensible defaults, override any field. */
export function makeAllocation(overrides?: Partial<AllocationEntry>): AllocationEntry {
  return {
    pool: ZERO_POOL,
    chain: 1,
    dex: "uniswap_v3",
    pct: 1.0,
    expectedApr: 0.12,
    ...overrides,
  };
}

/** Create a test pool snapshot with sensible defaults, override any field. */
export function makeSnapshot(overrides?: Partial<PoolSnapshot>): PoolSnapshot {
  return {
    pool: ZERO_POOL,
    chain: 1,
    ts: Date.now(),
    volume24h: 100_000,
    tvl: 5_000_000,
    feePct: 0.0005,
    basePriceUsd: 1.0,
    quotePriceUsd: 1.0,
    exchangeRate: 1.0,
    priceChangeH1: 0,
    priceChangeH24: 0,
    ...overrides,
  };
}

/** Check if an error message indicates a transient RPC failure (rate-limit, timeout, network). */
export function isTransientRpcError(msg: string): boolean {
  const patterns = [
    "ETIMEDOUT",
    "ECONNREFUSED",
    "ECONNRESET",
    "ENOTFOUND",
    "429",
    "502",
    "503",
    "504",
    "fetch failed",
    "timeout",
    "rate limit",
    "too many requests",
    "getaddrinfo",
    "socket hang up",
  ];
  const lower = msg.toLowerCase();
  return patterns.some((p) => lower.includes(p.toLowerCase()));
}

/** Create a mock DragonflyStore for isolated tests. */
export function createMockStore(positionsMap = new Map<string, any>()) {
  let optimizerState: { vec: number[]; fitness: number } | null = null;
  let epoch = 0;
  let regimeSuppress = 0;
  let candleCursor = 0;

  return {
    getPositions: () => Promise.resolve([...positionsMap.values()]),
    savePosition: (p: any) => { positionsMap.set(p.id, p); return Promise.resolve(); },
    deletePosition: (id: string) => { positionsMap.delete(id); return Promise.resolve(); },
    getOptimizerState: () => Promise.resolve(optimizerState),
    saveOptimizerState: (vec: number[], fitness: number) => {
      optimizerState = { vec, fitness };
      return Promise.resolve();
    },
    getEpoch: () => Promise.resolve(epoch),
    incrementEpoch: () => Promise.resolve(++epoch),
    getRegimeSuppressUntil: () => Promise.resolve(regimeSuppress),
    setRegimeSuppressUntil: (e: number) => { regimeSuppress = e; return Promise.resolve(); },
    getLatestCandleTs: () => Promise.resolve(candleCursor),
    setLatestCandleTs: (ts: number) => { candleCursor = ts; return Promise.resolve(); },
    deleteAll: () => {
      positionsMap.clear();
      optimizerState = null;
      epoch = 0;
      regimeSuppress = 0;
      candleCursor = 0;
      return Promise.resolve();
    },
  };
}

/** Aggregate M1 candles to M15 (delegates to production aggregateCandles). */
import { aggregateCandles } from "../shared/format";
import { M15_MS } from "../src/config/params";
export const synthM15 = (m1: Candle[]) => aggregateCandles(m1, M15_MS);
