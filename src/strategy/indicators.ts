import type { Candle } from "../types";
import { VFORCE_SIGMOID_SCALE } from "../config/params";
import { cap } from "../utils";

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
