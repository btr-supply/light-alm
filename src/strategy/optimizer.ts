import type { RangeParams } from "../types";
import {
  KS_YIELD_WINDOW_MS,
  KS_RS_WINDOW_MS,
  KS_MAX_RS_COUNT,
  KS_PATHOLOGICAL_MIN,
  KS_GAS_BUDGET_PCT,
  NM_RESTARTS,
  OPT_BOUNDS,
} from "../config/params";
import { log, mean } from "../utils";

// Re-export submodules so existing consumers keep working
export { detectRegime } from "./regime";
export { fitness, type FitnessContext } from "./fitness";
export {
  nelderMead,
  rangeParamsToVec,
  vecToRangeParams,
  clampToBounds,
  defaultRangeParams,
} from "./nelder-mead";

import { fitness } from "./fitness";
import type { FitnessContext } from "./fitness";
import { nelderMead, rangeParamsToVec, vecToRangeParams, clampToBounds, defaultRangeParams } from "./nelder-mead";

// ---- Public API ----

/** Per-pair warm-start state, keyed by pair ID */
const prevBestByPair = new Map<string, number[]>();

/** Generate a random starting point uniformly within OPT_BOUNDS. */
function randomStart(): number[] {
  return OPT_BOUNDS.map((b) => b.lo + Math.random() * (b.hi - b.lo));
}

export function optimize(
  ctx: FitnessContext,
  pairId = "default",
): { params: RangeParams; fitness: number; evals: number } {
  const initial = prevBestByPair.get(pairId) ?? rangeParamsToVec(defaultRangeParams());
  const evalFn = (x: number[]) => fitness(x, ctx);

  // Evaluate defaults as baseline
  const defaultVec = rangeParamsToVec(defaultRangeParams());
  const defaultFit = evalFn(defaultVec);

  // Multi-restart NM: warm-start + random restarts to escape local optima
  let bestResult = nelderMead(evalFn, initial);
  let totalEvals = bestResult.evals;

  for (let r = 1; r < NM_RESTARTS; r++) {
    const result = nelderMead(evalFn, randomStart());
    totalEvals += result.evals;
    if (result.fitness > bestResult.fitness) bestResult = result;
  }

  // Fallback guard: if optimizer is worse than defaults, use defaults
  if (bestResult.fitness <= defaultFit) {
    log.debug(
      `Optimizer fitness ${bestResult.fitness.toFixed(6)} <= default ${defaultFit.toFixed(6)}, using defaults`,
    );
    prevBestByPair.set(pairId, defaultVec);
    return { params: defaultRangeParams(), fitness: defaultFit, evals: totalEvals };
  }

  prevBestByPair.set(pairId, bestResult.best);
  const params = vecToRangeParams(clampToBounds(bestResult.best));
  log.debug(
    `Optimizer: fitness=${bestResult.fitness.toFixed(6)} evals=${totalEvals} rs=${params.rsThreshold.toFixed(3)}`,
  );
  return { params, fitness: bestResult.fitness, evals: totalEvals };
}

/** Set warm-start state from persisted data (e.g. loaded from DragonflyDB on startup) */
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
  cycleSec = 900,
): { useDefaults: boolean; reason: string } {
  // Negative yield: trailing 6h net yield < 0 (dynamic count based on cycle interval)
  const yieldCount = Math.ceil(KS_YIELD_WINDOW_MS / (cycleSec * 1000));
  if (state.trailingYields.length >= yieldCount) {
    const recent = state.trailingYields.slice(-yieldCount);
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
