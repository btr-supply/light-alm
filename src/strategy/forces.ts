import type { Candle, Forces, ForceParams } from "../types";
import {
  DEFAULT_FORCE_PARAMS,
  MTF_CANDLES,
  MTF_WEIGHTS,
  RSI_PERIOD,
  TREND_SCALE,
  VFORCE_SIGMOID_SCALE,
  M15_MS,
  H1_MS,
  H4_MS,
} from "../config/params";
import { cap } from "../../shared/format";
import { mean, std, sma, rsi } from "../utils";

// ---- Parkinson volatility (inlined from former indicators.ts) ----

const LN2 = Math.log(2);

/**
 * Parkinson volatility estimator — uses H-L range data, ~5x more statistically
 * efficient than close-to-close (Parkinson 1980).
 * Returns per-bar sigma (same period as input candles).
 */
export function parkinsonVolatility(candles: Candle[], lookback: number): number {
  const slice = candles.slice(-lookback);
  if (slice.length < 2) return 0;
  let sumSq = 0;
  let valid = 0;
  for (let i = 0; i < slice.length; i++) {
    if (slice[i].l <= 0 || slice[i].h <= 0) continue;
    const r = Math.log(slice[i].h / slice[i].l);
    sumSq += r * r;
    valid++;
  }
  if (valid < 2) return 0;
  return Math.sqrt(sumSq / (4 * valid * LN2));
}

/**
 * Convert Parkinson per-bar sigma to vforce (0-100 scale).
 * The sigmoid scaling factor (60) is calibrated for M15 candle periods:
 * per-bar sigma ~0.002 (typical stable) → vforce ~11
 * per-bar sigma ~0.01 (typical volatile) → vforce ~45
 * per-bar sigma ~0.03 (crisis) → vforce ~83
 */
export function parkinsonVforce(candles: Candle[], lookback: number): number {
  const sigma = parkinsonVolatility(candles, lookback);
  return cap(100 * (1 - Math.exp(-VFORCE_SIGMOID_SCALE * sigma)), 0, 100);
}

/**
 * Compute volatility force (0-100): Parkinson estimator on OHLC data.
 * Falls back to CC (std/mean) when candle H-L data is unavailable.
 */
export function vforce(candles: Candle[], lookback: number): Forces["v"] {
  const slice = candles.slice(-lookback);
  if (slice.length < 2) return { force: 0, mean: 0, std: 0 };
  const closes = slice.map((c) => c.c);
  const m = mean(closes);
  const s = std(closes);
  // Use Parkinson if we have valid H-L data
  const hasHL = slice.some((c) => c.h > c.l && c.l > 0);
  const force = hasHL ? parkinsonVforce(slice, lookback) : cap(m > 0 ? (s / m) * 100 : 0, 0, 100);
  return { force, mean: m, std: s };
}

/**
 * Compute momentum force (0-100): RSI-based.
 */
export function mforce(closes: number[], lookback: number): Forces["m"] {
  if (closes.length < 2) return { force: 50, up: 0, down: 0 };
  const r = rsi(closes, Math.min(RSI_PERIOD, lookback));
  const n = Math.min(lookback, closes.length - 1);
  let up = 0,
    down = 0;
  for (let i = closes.length - n; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) up++;
    else if (d < 0) down++;
  }
  return { force: cap(r, 0, 100), up, down };
}

/**
 * Compute trend force (0-100): short/long MA crossover.
 */
export function tforce(closes: number[], lookback: number): Forces["t"] {
  const n = Math.min(lookback, closes.length);
  if (n < 4) {
    const last = closes[closes.length - 1] || 0;
    return { ma0: last, ma1: last, force: 50 };
  }
  const shortP = Math.floor(n / 3);
  const longP = Math.floor((n * 2) / 3);
  const shortMa = sma(closes, shortP);
  const longMa = sma(closes, longP);
  if (!shortMa.length || !longMa.length) {
    const last = closes[closes.length - 1] || 0;
    return { ma0: last, ma1: last, force: 50 };
  }
  const ma0 = shortMa[shortMa.length - 1];
  const ma1 = longMa[longMa.length - 1];
  const force = ma1 > 0 ? cap(50 + ((ma0 - ma1) / ma1) * TREND_SCALE, 0, 100) : 50;
  return { ma0, ma1, force };
}

/**
 * Compute all 3 forces from a single timeframe of candles.
 */
export function computeForces(
  candles: Candle[],
  params: ForceParams = DEFAULT_FORCE_PARAMS,
): Forces {
  const closes = candles.map((c) => c.c);
  return {
    v: vforce(candles, params.volatility.lookback),
    m: mforce(closes, params.momentum.lookback),
    t: tforce(closes, params.trend.lookback),
  };
}

import { aggregateCandles } from "../../shared/format";

/** Neutral forces returned when insufficient candle data is available. */
export const NEUTRAL_FORCES: Forces = {
  v: { force: 0, mean: 0, std: 0 },
  m: { force: 50, up: 0, down: 0 },
  t: { ma0: 0, ma1: 0, force: 50 },
};

/**
 * Blend pre-computed per-timeframe forces with MTF_WEIGHTS.
 * Use when timeframes are pre-aggregated (e.g. catch-up) to avoid re-aggregation.
 */
export function blendForces(frames: Forces[]): Forces {
  const w = MTF_WEIGHTS;
  let vForce = 0, vMean = 0, vStd = 0;
  let mForce = 0, mUp = 0, mDown = 0;
  let tForce = 0, tMa0 = 0, tMa1 = 0;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i], wi = w[i];
    vForce += f.v.force * wi; vMean += f.v.mean * wi; vStd += f.v.std * wi;
    mForce += f.m.force * wi; mUp += f.m.up * wi; mDown += f.m.down * wi;
    tForce += f.t.force * wi; tMa0 += f.t.ma0 * wi; tMa1 += f.t.ma1 * wi;
  }
  return {
    v: { force: vForce, mean: vMean, std: vStd },
    m: { force: mForce, up: mUp, down: mDown },
    t: { force: tForce, ma0: tMa0, ma1: tMa1 },
  };
}

/**
 * Multi-timeframe composite forces: weighted blend of M15, H1, H4.
 * M1/M5 dropped — sub-15min signals are microstructure noise for LP decisions.
 * Accepts M1 candles and aggregates internally. Pass precomputed M15 to avoid redundant aggregation.
 */
export function compositeForces(
  m1Candles: Candle[],
  params: ForceParams = DEFAULT_FORCE_PARAMS,
  precomputedM15?: Candle[],
): Forces {
  const m15 = precomputedM15 ?? aggregateCandles(m1Candles, M15_MS);
  const h1 = aggregateCandles(m1Candles, H1_MS);
  const h4 = aggregateCandles(h1, H4_MS);

  return blendForces([
    computeForces(m15.slice(-MTF_CANDLES.m15), params),
    computeForces(h1.slice(-MTF_CANDLES.h1), params),
    computeForces(h4.slice(-MTF_CANDLES.h4), params),
  ]);
}
