import type { Candle, RangeParams, RegimeState } from "../types";
import { parkinsonVolatility, parkinsonVforce } from "./forces";
import { baseRangeWidth, rawDivergence } from "./range";
import {
  SECONDS_PER_YEAR,
  DEFAULT_FORCE_PARAMS,
  CANDLES_1H,
  TRAILING_EPOCHS,
  EPOCH_SEC,
  OPT_BOUNDS,
  NM_ALPHA,
  NM_GAMMA,
  NM_RHO,
  NM_SIGMA,
  NM_MAX_EVALS,
  NM_TOL,
  FITNESS_MIN_CANDLES,
  FITNESS_TRAIN_SPLIT,
  FITNESS_OVERFIT_RATIO,
  FITNESS_MIN_RS_GAP,
  FITNESS_SWAP_FRICTION,
  REGIME_VOL_SIGMA_MULT,
  REGIME_SUPPRESS_EPOCHS,
  REGIME_DISPLACEMENT_STABLE,
  REGIME_DISPLACEMENT_VOLATILE,
  REGIME_EPOCH_CANDLES,
  REGIME_VOLUME_ANOMALY_MULT,
  REGIME_WIDEN_FACTOR,
  REGIME_MIN_HOURLY_SAMPLES,
  KS_RS_WINDOW_MS,
  KS_MAX_RS_COUNT,
  KS_PATHOLOGICAL_MIN,
  KS_GAS_BUDGET_PCT,
} from "../config/params";
import { cap } from "../../shared/format";
import { log, mean, std } from "../utils";

const DIM = OPT_BOUNDS.length;

export function rangeParamsToVec(p: RangeParams): number[] {
  return [p.baseMin, p.baseMax, p.vforceExp, p.vforceDivider, p.rsThreshold];
}

export function vecToRangeParams(v: number[]): RangeParams {
  return {
    baseMin: v[0],
    baseMax: v[1],
    vforceExp: v[2],
    vforceDivider: v[3],
    rsThreshold: v[4],
  };
}

function clampToBounds(v: number[]): number[] {
  return v.map((x, i) => cap(x, OPT_BOUNDS[i].lo, OPT_BOUNDS[i].hi));
}

export function defaultRangeParams(): RangeParams {
  const { baseRange, rsThreshold } = DEFAULT_FORCE_PARAMS;
  return {
    baseMin: baseRange.min,
    baseMax: baseRange.max,
    vforceExp: baseRange.vforceExp,
    vforceDivider: baseRange.vforceDivider,
    rsThreshold,
  };
}

// ---- Regime detection (circuit breaker) ----

export function detectRegime(candles: Candle[], epoch: number, isStable: boolean): RegimeState {
  const normal: RegimeState = {
    suppressed: false,
    reason: "",
    widenFactor: 1.0,
    suppressUntilEpoch: 0,
  };
  if (candles.length < CANDLES_1H) return normal;

  // 1h trailing Parkinson vol (last 60 M1 candles)
  const vol1h = parkinsonVolatility(candles.slice(-CANDLES_1H), CANDLES_1H);
  // 30d mean + std of hourly vol (sample every 60 candles)
  const hourlyVols: number[] = [];
  for (let i = CANDLES_1H; i <= candles.length; i += CANDLES_1H) {
    hourlyVols.push(parkinsonVolatility(candles.slice(i - CANDLES_1H, i), CANDLES_1H));
  }
  if (hourlyVols.length > REGIME_MIN_HOURLY_SAMPLES) {
    const mu = mean(hourlyVols);
    const sigma = std(hourlyVols);
    if (vol1h > mu + REGIME_VOL_SIGMA_MULT * sigma) {
      return {
        suppressed: true,
        reason: "vol_spike",
        widenFactor: 1.0,
        suppressUntilEpoch: epoch + REGIME_SUPPRESS_EPOCHS,
      };
    }
  }

  // Price displacement check
  const recent = candles.slice(-CANDLES_1H);
  const pNow = recent[recent.length - 1].c;
  const p1hAgo = recent[0].c;
  const displacement = Math.abs(pNow - p1hAgo) / p1hAgo;
  const displacementThreshold = isStable
    ? REGIME_DISPLACEMENT_STABLE
    : REGIME_DISPLACEMENT_VOLATILE;
  if (displacement > displacementThreshold) {
    return {
      suppressed: true,
      reason: "price_displacement",
      widenFactor: 1.0,
      suppressUntilEpoch: epoch + REGIME_SUPPRESS_EPOCHS,
    };
  }

  // Volume anomaly
  const recentVol = candles.slice(-REGIME_EPOCH_CANDLES).reduce((s, c) => s + c.v, 0);
  const avgEpochVol =
    candles.reduce((s, c) => s + c.v, 0) / (candles.length / REGIME_EPOCH_CANDLES);
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

// ---- Fitness function: net yield = gross fees - discrete LVR - rebalancing costs ----
//
// LVR here = crystallized impermanent loss at each range shift (RS/PRA).
// When price moves and RS triggers, the LP position has been imbalanced by the AMM
// (sold the appreciating token on the way up). At rebalancing we buy it back at spot,
// crystallizing the loss: LVR = HODL_value - LP_value at the moment of range shift.

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

  // Reject overfitting: validation must be >= threshold of training
  if (trainFit > 0 && valFit < FITNESS_OVERFIT_RATIO * trainFit) return -Infinity;
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

  let totalFeeApr = 0;
  let totalRebalCostUsd = 0;
  let lastRebalEpoch = -(FITNESS_MIN_RS_GAP + 1); // allow first rebalance

  // Current open position state
  const initPrice = candles[0].c;
  const initVf = 50; // neutral vforce at start
  const initHalf = initPrice * baseRangeWidthFloored(initVf, p);
  let posPL = initPrice - initHalf;
  let posPH = initPrice + initHalf;
  let posEntry = initPrice;
  let posEntryValue = lpValue(initPrice, posPL, posPH);

  const dtYears = EPOCH_SEC / SECONDS_PER_YEAR; // epoch duration in years
  let totalContinuousLvr = 0;

  for (let i = 0; i < candles.length; i++) {
    const price = candles[i].c;

    // Compute vforce from local trailing window
    const localSlice = candles.slice(Math.max(0, i - TRAILING_EPOCHS), i + 1);
    const localSigma = parkinsonVolatility(localSlice, localSlice.length);
    const vf = parkinsonVforce(localSlice, localSlice.length);

    // Target range for this epoch
    const halfWidth = price * baseRangeWidthFloored(vf, p);
    const targetPL = price - halfWidth;
    const targetPH = price + halfWidth;

    // Fee APR: only earned when price is within the active position range.
    // baseApr already represents the pool-level marginal LP return; no concentration multiplier needed.
    totalFeeApr += price >= posPL && price <= posPH ? baseApr : 0;

    // Continuous LVR per Milionis et al. (2022): (sigma^2 / 2) * sqrt(p) / (sqrt(pH) - sqrt(pL)) * dt
    if (price >= posPL && price <= posPH) {
      const sqPL = Math.sqrt(posPL);
      const sqPH = Math.sqrt(posPH);
      const rangeDenom = sqPH - sqPL;
      if (rangeDenom > 1e-18) {
        totalContinuousLvr +=
          ((((localSigma * localSigma) / 2) * Math.sqrt(price)) / rangeDenom) * dtYears;
      }
    }

    // RS divergence check against current open position
    if (posPH > posPL) {
      const divergence = rawDivergence(posPL, posPH, targetPL, targetPH);

      if (divergence > p.rsThreshold && i - lastRebalEpoch >= FITNESS_MIN_RS_GAP) {
        // RANGE SHIFT — crystallize IL as LVR
        // LVR = HODL value - LP value, as fraction of entry value
        // Note: discrete LVR at RS events is a subset of continuous LVR (Milionis et al.)
      // accumulated above, so we don't double-count it here.

        // Gas + swap friction cost (in USD)
        const swapFriction = (2 * poolFee + FITNESS_SWAP_FRICTION) * (1 + vf / 100);
        totalRebalCostUsd += gasCostUsd + swapFriction * positionValueUsd;

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
  const windowSec = n * EPOCH_SEC;
  // Annualize all terms
  const avgFeeApr = totalFeeApr / n; // already annualized
  const continuousLvrAnnualized = totalContinuousLvr * (SECONDS_PER_YEAR / windowSec); // already per-epoch, sum → annual
  const rebalCostAnnualized =
    positionValueUsd > 0
      ? (totalRebalCostUsd / positionValueUsd) * (SECONDS_PER_YEAR / windowSec)
      : 0;
  // Use continuous LVR only (Milionis et al.) — discrete LVR at RS events is already
  // captured as a subset of continuous accumulation, so subtracting both double-counts.
  return avgFeeApr - continuousLvrAnnualized - rebalCostAnnualized;
}

// ---- Nelder-Mead simplex optimizer ----

interface Vertex {
  x: number[];
  f: number;
}

function centroid(vertices: Vertex[], excludeIdx: number): number[] {
  const n = vertices.length - 1;
  const c = Array.from<number>({ length: DIM }).fill(0);
  for (let i = 0; i < vertices.length; i++) {
    if (i === excludeIdx) continue;
    for (let d = 0; d < DIM; d++) c[d] += vertices[i].x[d];
  }
  for (let d = 0; d < DIM; d++) c[d] /= n;
  return c;
}

function reflect(c: number[], worst: number[], alpha: number): number[] {
  return c.map((ci, d) => ci + alpha * (ci - worst[d]));
}

export function nelderMead(
  evalFn: (x: number[]) => number,
  initialGuess: number[],
  perturbScale = 0.1,
): { best: number[]; fitness: number; evals: number } {
  // Initialize simplex: initial guess + DIM perturbation vertices
  // Alternate +/- perturbation direction to avoid degenerate simplex near bounds
  const vertices: Vertex[] = [];
  const g = clampToBounds(initialGuess);
  vertices.push({ x: g, f: evalFn(g) });

  for (let d = 0; d < DIM; d++) {
    const v = [...g];
    const range = OPT_BOUNDS[d].hi - OPT_BOUNDS[d].lo;
    const sign = d % 2 === 0 ? 1 : -1;
    const perturbed = v[d] + sign * range * perturbScale;
    v[d] = cap(perturbed, OPT_BOUNDS[d].lo, OPT_BOUNDS[d].hi);
    // If clamped to same value, try opposite direction
    if (Math.abs(v[d] - g[d]) < range * 1e-6) {
      v[d] = cap(v[d] - sign * range * perturbScale, OPT_BOUNDS[d].lo, OPT_BOUNDS[d].hi);
    }
    vertices.push({ x: v, f: evalFn(v) });
  }

  let evals = DIM + 1;

  for (let iter = 0; iter < NM_MAX_EVALS - evals; iter++) {
    // Sort ascending by fitness (we maximize, so best = last)
    vertices.sort((a, b) => a.f - b.f);
    const worst = vertices[0];
    const secondWorst = vertices[1];
    const best = vertices[DIM];

    // Convergence check
    if (Math.abs(best.f - worst.f) < NM_TOL) break;

    const c = centroid(vertices, 0);

    // Reflect
    const xr = clampToBounds(reflect(c, worst.x, NM_ALPHA));
    const fr = evalFn(xr);
    evals++;

    if (fr >= secondWorst.f && fr <= best.f) {
      vertices[0] = { x: xr, f: fr };
      continue;
    }

    if (fr > best.f) {
      // Expand
      const xe = clampToBounds(reflect(c, worst.x, NM_GAMMA));
      const fe = evalFn(xe);
      evals++;
      vertices[0] = fe > fr ? { x: xe, f: fe } : { x: xr, f: fr };
      continue;
    }

    // Contract
    const xc = clampToBounds(c.map((ci, d) => ci + NM_RHO * (worst.x[d] - ci)));
    const fc = evalFn(xc);
    evals++;

    if (fc > worst.f) {
      vertices[0] = { x: xc, f: fc };
      continue;
    }

    // Shrink: update all vertices except best toward best
    for (let i = 0; i < DIM; i++) {
      const xs = vertices[DIM].x.map((bi, d) => bi + NM_SIGMA * (vertices[i].x[d] - bi));
      const clamped = clampToBounds(xs);
      vertices[i] = { x: clamped, f: evalFn(clamped) };
      evals++;
    }
  }

  vertices.sort((a, b) => a.f - b.f);
  const best = vertices[DIM];
  return { best: best.x, fitness: best.f, evals };
}

// ---- Public API ----

/** Per-pair warm-start state, keyed by pair ID */
const prevBestByPair = new Map<string, number[]>();

export function optimize(
  ctx: FitnessContext,
  pairId = "default",
): { params: RangeParams; fitness: number; evals: number } {
  const initial = prevBestByPair.get(pairId) ?? rangeParamsToVec(defaultRangeParams());
  const evalFn = (x: number[]) => fitness(x, ctx);

  // Evaluate defaults as baseline
  const defaultVec = rangeParamsToVec(defaultRangeParams());
  const defaultFit = evalFn(defaultVec);

  const result = nelderMead(evalFn, initial);

  // Fallback guard: if optimizer is worse than defaults, use defaults
  if (result.fitness <= defaultFit) {
    log.debug(
      `Optimizer fitness ${result.fitness.toFixed(6)} <= default ${defaultFit.toFixed(6)}, using defaults`,
    );
    prevBestByPair.set(pairId, defaultVec);
    return { params: defaultRangeParams(), fitness: defaultFit, evals: result.evals };
  }

  prevBestByPair.set(pairId, result.best);
  const params = vecToRangeParams(clampToBounds(result.best));
  log.debug(
    `Optimizer: fitness=${result.fitness.toFixed(6)} evals=${result.evals} rs=${params.rsThreshold.toFixed(3)}`,
  );
  return { params, fitness: result.fitness, evals: result.evals };
}

/** Set warm-start state from persisted data (e.g. loaded from SQLite on startup) */
export function setWarmStart(pairId: string, vec: number[]) {
  prevBestByPair.set(pairId, vec);
}

/** Reset warm-start state (for testing or cold restart) */
export function resetOptimizer(pairId?: string) {
  if (pairId) prevBestByPair.delete(pairId);
  else prevBestByPair.clear();
}

// ---- Kill-switch checks ----

export interface KillSwitchState {
  trailingYields: number[]; // last N epoch net yields
  rsTimestamps: number[]; // RS trigger timestamps
  trailing24hGasUsd: number;
}

export function checkKillSwitches(
  state: KillSwitchState,
  positionValueUsd: number,
  optimizedParams: RangeParams,
): { useDefaults: boolean; reason: string } {
  // Negative yield: trailing 6h (24 epochs) net yield < 0
  if (state.trailingYields.length >= TRAILING_EPOCHS) {
    const recent = state.trailingYields.slice(-TRAILING_EPOCHS);
    if (mean(recent) < 0) return { useDefaults: true, reason: "negative_trailing_yield" };
  }

  // Excessive RS in trailing window
  const windowStart = Date.now() - KS_RS_WINDOW_MS;
  const recentRS = state.rsTimestamps.filter((t) => t > windowStart);
  if (recentRS.length > KS_MAX_RS_COUNT) return { useDefaults: true, reason: "excessive_rs" };

  // Pathological range: width below minimum viable threshold
  const rangeWidth = optimizedParams.baseMax - optimizedParams.baseMin;
  if (rangeWidth < KS_PATHOLOGICAL_MIN) {
    return { useDefaults: true, reason: "pathological_range" };
  }

  // Gas budget exceeded
  if (positionValueUsd > 0 && state.trailing24hGasUsd > KS_GAS_BUDGET_PCT * positionValueUsd) {
    return { useDefaults: true, reason: "gas_budget_exceeded" };
  }

  return { useDefaults: false, reason: "" };
}
