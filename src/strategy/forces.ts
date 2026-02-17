import type { Candle, Forces, ForceParams } from "../types";
import {
  DEFAULT_FORCE_PARAMS,
  MTF_CANDLES,
  MTF_WEIGHTS,
  RSI_PERIOD,
  TREND_SCALE,
} from "../config/params";
import { cap, mean, std, sma, rsi } from "../utils";
import { parkinsonVforce } from "./indicators";

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

/**
 * Aggregate candles into higher timeframes.
 */
export function aggregateCandles(source: Candle[], periodMinutes: number): Candle[] {
  const periodMs = periodMinutes * 60_000;
  const buckets = new Map<number, Candle>();
  for (const c of source) {
    const key = Math.floor(c.ts / periodMs) * periodMs;
    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, { ts: key, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v });
    } else {
      existing.h = Math.max(existing.h, c.h);
      existing.l = Math.min(existing.l, c.l);
      existing.c = c.c;
      existing.v += c.v;
    }
  }
  return [...buckets.values()].sort((a, b) => a.ts - b.ts);
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
  // Aggregate from M1 with absolute periods to avoid compounding rounding errors
  const m15 = precomputedM15 ?? aggregateCandles(m1Candles, 15);
  const h1 = aggregateCandles(m1Candles, 60);
  const h4 = aggregateCandles(m1Candles, 240);

  const frames = [
    computeForces(m15.slice(-MTF_CANDLES.m15), params),
    computeForces(h1.slice(-MTF_CANDLES.h1), params),
    computeForces(h4.slice(-MTF_CANDLES.h4), params),
  ];

  const w = MTF_WEIGHTS;

  let vForce = 0,
    vMean = 0,
    vStd = 0;
  let mForce = 0,
    mUp = 0,
    mDown = 0;
  let tForce = 0,
    tMa0 = 0,
    tMa1 = 0;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i],
      wi = w[i];
    vForce += f.v.force * wi;
    vMean += f.v.mean * wi;
    vStd += f.v.std * wi;
    mForce += f.m.force * wi;
    mUp += f.m.up * wi;
    mDown += f.m.down * wi;
    tForce += f.t.force * wi;
    tMa0 += f.t.ma0 * wi;
    tMa1 += f.t.ma1 * wi;
  }
  return {
    v: { force: vForce, mean: vMean, std: vStd },
    m: { force: mForce, up: mUp, down: mDown },
    t: { force: tForce, ma0: tMa0, ma1: tMa1 },
  };
}
