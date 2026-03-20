import type { Candle, RegimeState } from "../types";
import { parkinsonVolatility } from "./forces";
import {
  M1_PER_HOUR,
  REGIME_VOL_SIGMA_MULT,
  REGIME_SUPPRESS_CYCLES,
  REGIME_DISPLACEMENT_STABLE,
  REGIME_DISPLACEMENT_VOLATILE,
  REGIME_DISPLACEMENT_VOL_MULT,
  REGIME_DISPLACEMENT_MIN,
  REGIME_VOL_WINDOW,
  REGIME_VOLUME_ANOMALY_MULT,
  REGIME_WIDEN_FACTOR,
  REGIME_MIN_HOURLY_SAMPLES,
} from "../config/params";
import { mean, std } from "../utils";

export function detectRegime(candles: Candle[], epoch: number, isStable: boolean): RegimeState {
  const normal: RegimeState = {
    suppressed: false,
    reason: "",
    widenFactor: 1.0,
    suppressUntilEpoch: 0,
  };
  if (candles.length < M1_PER_HOUR) return normal;

  // 1h trailing Parkinson vol (last 60 M1 candles)
  const vol1h = parkinsonVolatility(candles.slice(-M1_PER_HOUR), M1_PER_HOUR);
  // 30d mean + std of hourly vol (sample every 60 candles)
  const hourlyVols: number[] = [];
  for (let i = M1_PER_HOUR; i <= candles.length; i += M1_PER_HOUR) {
    hourlyVols.push(parkinsonVolatility(candles.slice(i - M1_PER_HOUR, i), M1_PER_HOUR));
  }
  let muVol = 0;
  if (hourlyVols.length > REGIME_MIN_HOURLY_SAMPLES) {
    muVol = mean(hourlyVols);
    const sigma = std(hourlyVols);
    if (vol1h > muVol + REGIME_VOL_SIGMA_MULT * sigma) {
      return {
        suppressed: true,
        reason: "vol_spike",
        widenFactor: 1.0,
        suppressUntilEpoch: epoch + REGIME_SUPPRESS_CYCLES,
      };
    }
  }

  // Price displacement check — vol-relative for volatile pairs, fixed for stables
  const recent = candles.slice(-M1_PER_HOUR);
  const pNow = recent[recent.length - 1].c;
  const p1hAgo = recent[0].c;
  const displacement = Math.abs(pNow - p1hAgo) / p1hAgo;
  // Stables: fixed threshold (vol too low for vol-relative to work)
  // Volatile: K × σ_per_minute × √60 = expected 1h move at K sigma, floored
  const displacementThreshold = isStable
    ? REGIME_DISPLACEMENT_STABLE
    : muVol > 0
      ? Math.max(REGIME_DISPLACEMENT_VOL_MULT * muVol * Math.sqrt(M1_PER_HOUR), REGIME_DISPLACEMENT_MIN)
      : REGIME_DISPLACEMENT_VOLATILE;
  if (displacement > displacementThreshold) {
    return {
      suppressed: true,
      reason: "price_displacement",
      widenFactor: 1.0,
      suppressUntilEpoch: epoch + REGIME_SUPPRESS_CYCLES,
    };
  }

  // Volume anomaly
  const recentVol = candles.slice(-REGIME_VOL_WINDOW).reduce((s, c) => s + c.v, 0);
  const avgEpochVol =
    candles.reduce((s, c) => s + c.v, 0) / (candles.length / REGIME_VOL_WINDOW);
  if (avgEpochVol > 0 && recentVol > REGIME_VOLUME_ANOMALY_MULT * avgEpochVol) {
    return {
      suppressed: false,
      reason: "volume_anomaly",
      widenFactor: REGIME_WIDEN_FACTOR,
      suppressUntilEpoch: 0,
    };
  }

  return normal;
}
