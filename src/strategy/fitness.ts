import type { Candle, RangeParams } from "../types";
import { parkinsonVolatility, parkinsonVforce } from "./forces";
import { baseRangeWidth, rawDivergence } from "./range";
import { cap } from "../../shared/format";
import {
  SECONDS_PER_YEAR,
  SIM_VOL_LOOKBACK,
  SIM_BAR_SEC,
  SIM_BARS_PER_YEAR,
  FITNESS_MIN_CANDLES,
  FITNESS_TRAIN_SPLIT,
  FITNESS_OVERFIT_RATIO,
  SIM_MIN_REBAL_GAP,
  FITNESS_SWAP_FRICTION,
  FEE_CONCENTRATION_CAP,
  DEFAULT_CAPITAL_USD,
} from "../config/params";
import { vecToRangeParams, clampToBounds } from "./nelder-mead";

export interface FitnessContext {
  candles: Candle[]; // M15 candles for simulation
  baseApr: number; // base pool APR from utilization
  poolFee: number; // pool fee (decimal, e.g. 0.0005)
  gasCostUsd: number; // estimated gas cost per rebalance in USD
  positionValueUsd: number; // position value for friction calc
}

/** Range width from vforce with floor at baseMin. */
function baseRangeWidthFloored(vforce: number, p: RangeParams): number {
  const raw = baseRangeWidth(vforce, p.baseMin, p.baseMax, p.vforceExp, p.vforceDivider);
  return Math.max(raw, p.baseMin);
}

function sqrtBounds(pL: number, pH: number): [number, number] {
  return [Math.sqrt(Math.max(pL, 1e-18)), Math.sqrt(Math.max(pH, pL + 1e-18))];
}

/**
 * Concentrated LP position value per unit liquidity (in token1/USDC terms).
 * Uses UniV3 math: x(P) and y(P) token amounts depend on price vs range.
 */
function lpValue(price: number, pL: number, pH: number): number {
  const [sqPL, sqPH] = sqrtBounds(pL, pH);
  if (price <= pL) return price * (1 / sqPL - 1 / sqPH);
  if (price >= pH) return sqPH - sqPL;
  return 2 * Math.sqrt(price) - sqPL - price / sqPH;
}

/**
 * HODL value: what you'd have if you just held the entry token amounts.
 * At entry price P0 in range [pL, pH], the initial amounts per unit L are:
 *   x0 = 1/sqrt(P0) - 1/sqrt(pH)  (token0)
 *   y0 = sqrt(P0) - sqrt(pL)       (token1/USDC)
 * HODL value at price P = x0 * P + y0
 */
function hodlValue(price: number, entryPrice: number, pL: number, pH: number): number {
  const [sqPL, sqPH] = sqrtBounds(pL, pH);
  const sqP0 = Math.sqrt(entryPrice);
  const x0 = 1 / sqP0 - 1 / sqPH;
  const y0 = sqP0 - sqPL;
  return x0 * price + y0;
}

export function fitness(vec: number[], ctx: FitnessContext): number {
  const p = vecToRangeParams(clampToBounds(vec));
  const { candles, baseApr, poolFee, gasCostUsd, positionValueUsd } = ctx;
  if (candles.length < FITNESS_MIN_CANDLES) return -Infinity;

  // Split: train on first portion, validate on last portion
  const splitIdx = Math.floor(candles.length * FITNESS_TRAIN_SPLIT);
  const trainFit = simulateWindow(
    candles.slice(0, splitIdx),
    p,
    baseApr,
    poolFee,
    gasCostUsd,
    positionValueUsd,
  );
  const valFit = simulateWindow(
    candles.slice(splitIdx),
    p,
    baseApr,
    poolFee,
    gasCostUsd,
    positionValueUsd,
  );

  // Reject overfitting: validation must be consistent with training
  if (trainFit > 0 && valFit < FITNESS_OVERFIT_RATIO * trainFit) return -Infinity;
  // Reject lucky validation: unprofitable training + positive validation = fitting noise
  if (trainFit <= 0 && valFit > 0) return -Infinity;
  return valFit;
}

function simulateWindow(
  candles: Candle[],
  p: RangeParams,
  baseApr: number,
  poolFee: number,
  gasCostUsd: number,
  positionValueUsd: number,
): number {
  if (candles.length < 2) return 0;

  // Fallback to standard position size so gas/friction costs are never silently zeroed
  const posValue = positionValueUsd > 0 ? positionValueUsd : DEFAULT_CAPITAL_USD;

  let totalFeeApr = 0;
  let totalRebalCostUsd = 0;
  let lastRebalEpoch = -(SIM_MIN_REBAL_GAP + 1); // allow first rebalance

  // Current open position state
  const initPrice = candles[0].c;
  const initVf = 50; // neutral vforce at start
  const initHalf = initPrice * baseRangeWidthFloored(initVf, p);
  let posPL = initPrice - initHalf;
  let posPH = initPrice + initHalf;
  let posEntry = initPrice;
  let posEntryValue = lpValue(initPrice, posPL, posPH);

  const dtYears = SIM_BAR_SEC / SECONDS_PER_YEAR; // epoch duration in years
  const sqrtEpochsPerYear = Math.sqrt(SIM_BARS_PER_YEAR);
  // Fee concentration reference: fee-tier-scaled average LP range width
  // Higher fee pools attract wider-range LPs → larger reference denominator
  const refHalfW = cap(poolFee * 100, 0.01, 0.5);
  let totalContinuousLvr = 0;

  for (let i = 0; i < candles.length; i++) {
    const price = candles[i].c;

    // Compute vforce from local trailing window
    const localSlice = candles.slice(Math.max(0, i - SIM_VOL_LOOKBACK), i + 1);
    const localSigma = parkinsonVolatility(localSlice, localSlice.length);
    const vf = parkinsonVforce(localSlice, localSlice.length);

    // Target range for this epoch
    const halfWidth = price * baseRangeWidthFloored(vf, p);
    const targetPL = price - halfWidth;
    const targetPH = price + halfWidth;

    const inRange = price >= posPL && price <= posPH;

    if (inRange) {
      // Fee concentration: narrower LP ranges earn proportionally more fees per unit
      // capital (V3/V4 capital efficiency). lpValue ratio gives the concentration
      // multiplier relative to the pool's average LP width.
      const refPL = price * (1 - refHalfW);
      const refPH = price * (1 + refHalfW);
      const concentration = Math.min(
        lpValue(price, refPL, refPH) / Math.max(lpValue(price, posPL, posPH), 1e-18),
        FEE_CONCENTRATION_CAP,
      );
      totalFeeApr += baseApr * concentration;

      // Continuous LVR (Milionis et al. 2022): (σ²/2) × √P / (√pH - √pL) × dt
      // Parkinson returns per-bar σ; Milionis requires annualized σ.
      const sigmaAnnual = localSigma * sqrtEpochsPerYear;
      const rangeDenom = Math.sqrt(posPH) - Math.sqrt(posPL);
      if (rangeDenom > 1e-18) {
        totalContinuousLvr +=
          ((((sigmaAnnual * sigmaAnnual) / 2) * Math.sqrt(price)) / rangeDenom) * dtYears;
      }
    }

    // RS divergence check against current open position
    if (posPH > posPL) {
      const divergence = rawDivergence(posPL, posPH, targetPL, targetPH);

      if (divergence > p.rsThreshold && i - lastRebalEpoch >= SIM_MIN_REBAL_GAP) {
        // RANGE SHIFT — crystallize IL as LVR
        // LVR = HODL value - LP value, as fraction of entry value
        // Note: discrete LVR at RS events is a subset of continuous LVR (Milionis et al.)
        // accumulated above, so we don't double-count it here.

        // Gas + swap friction cost (in USD)
        const swapFriction = (2 * poolFee + FITNESS_SWAP_FRICTION) * (1 + vf / 100);
        totalRebalCostUsd += gasCostUsd + swapFriction * posValue;

        // Open new position at current price with target range
        posPL = targetPL;
        posPH = targetPH;
        posEntry = price;
        posEntryValue = lpValue(price, posPL, posPH);
        lastRebalEpoch = i;
      }
    }
  }

  const n = candles.length;
  const windowSec = n * SIM_BAR_SEC;
  // Annualize all terms
  const avgFeeApr = totalFeeApr / n; // already annualized
  const continuousLvrAnnualized = totalContinuousLvr * (SECONDS_PER_YEAR / windowSec); // already per-epoch, sum → annual
  const rebalCostAnnualized =
    (totalRebalCostUsd / posValue) * (SECONDS_PER_YEAR / windowSec);
  // Use continuous LVR only (Milionis et al.) — discrete LVR at RS events is already
  // captured as a subset of continuous accumulation, so subtracting both double-counts.
  return avgFeeApr - continuousLvrAnnualized - rebalCostAnnualized;
}
