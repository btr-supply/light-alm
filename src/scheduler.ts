import type { PairConfig, Decision, Forces, ForceParams, RangeParams } from "./types";
import type { DragonflyStore } from "./data/store-dragonfly";
import {
  DEFAULT_FORCE_PARAMS,
  DEFAULT_FEE,
  POSITION_VALUE_USD,
  STABLE_TOKENS,
  BACKFILL_MS,
  EPOCHS_PER_YEAR,
} from "./config/params";
import { GAS_COST_USD } from "../shared/format";
import { fetchLatestM1, backfill } from "./data/ohlc";
import { fetchPoolSnapshots } from "./data/gecko";
import { getLastSnapshot } from "./data/store-o2";
import * as o2q from "./data/store-o2";
import { compositeForces, aggregateCandles } from "./strategy/forces";
import { computePoolAnalyses } from "./strategy/utilization";
import { waterFill } from "./strategy/allocation";
import { decide, buildPairAllocation } from "./strategy/decision";
import { executePRA, executeRS } from "./executor";
import { ingestToO2 } from "./infra/o2";
import { log, pct, errMsg } from "./utils";
import {
  detectRegime,
  optimize,
  checkKillSwitches,
  defaultRangeParams,
  rangeParamsToVec,
  setWarmStart,
  type FitnessContext,
  type KillSwitchState,
} from "./strategy/optimizer";
import { getPair } from "./state";

/**
 * Compute unrealized impermanent loss from position entry prices vs current price.
 * Uses the standard IL formula: IL = 2*sqrt(r)/(1+r) - 1 where r = currentPrice/entryPrice
 */
function computeIL(positions: { entryPrice: number; entryValueUsd: number }[], currentPrice: number): number {
  let total = 0;
  for (const p of positions) {
    if (p.entryPrice <= 0 || currentPrice <= 0) continue;
    const r = currentPrice / p.entryPrice;
    const ilFraction = 2 * Math.sqrt(r) / (1 + r) - 1;
    total += Math.abs(ilFraction) * p.entryValueUsd;
  }
  return total;
}

/** Save epoch snapshot with computed PnL fields to O2. */
function saveEpochSnapshot(
  pairId: string, epoch: number, ts: number, decision: string,
  positions: { entryPrice: number; entryValueUsd: number }[],
  currentPrice: number, currentApr: number, optimalApr: number, txCount: number,
) {
  const portfolioValueUsd = positions.reduce((sum, p) => sum + p.entryValueUsd, 0);
  const gasSpentUsd = txCount * GAS_COST_USD;
  const feesEarnedUsd = portfolioValueUsd > 0 ? currentApr * portfolioValueUsd / EPOCHS_PER_YEAR : 0;
  const ilUsd = computeIL(positions, currentPrice);
  const rangeEfficiency = optimalApr > 0 ? Math.min(currentApr / optimalApr, 1.0) : 0;
  const netPnlUsd = feesEarnedUsd - gasSpentUsd - ilUsd;

  ingestToO2("epoch_snapshots", [{
    pairId, epoch, ts, decision, portfolioValueUsd,
    feesEarnedUsd, gasSpentUsd, ilUsd, netPnlUsd, rangeEfficiency,
    currentApr, optimalApr, positionsCount: positions.length,
  }]);
}

/** Neutral forces returned when insufficient candle data is available. */
const NEUTRAL_FORCES: Forces = {
  v: { force: 0, mean: 0, std: 0 },
  m: { force: 50, up: 0, down: 0 },
  t: { ma0: 0, ma1: 0, force: 50 },
};

/**
 * Deep merge partial force params with defaults.
 */
export function mergeForceParams(partial?: Partial<ForceParams>): ForceParams {
  if (!partial) return { ...DEFAULT_FORCE_PARAMS };
  return {
    volatility: { ...DEFAULT_FORCE_PARAMS.volatility, ...partial.volatility },
    momentum: { ...DEFAULT_FORCE_PARAMS.momentum, ...partial.momentum },
    trend: { ...DEFAULT_FORCE_PARAMS.trend, ...partial.trend },
    confidence: { ...DEFAULT_FORCE_PARAMS.confidence, ...partial.confidence },
    baseRange: { ...DEFAULT_FORCE_PARAMS.baseRange, ...partial.baseRange },
    rsThreshold: partial.rsThreshold ?? DEFAULT_FORCE_PARAMS.rsThreshold,
  };
}

/** Build kill-switch state from O2 queries */
async function buildKillSwitchState(
  pairId: string,
  gasCostEstimate: number,
): Promise<KillSwitchState> {
  const [trailingYields, rsTimestamps, txCount] = await Promise.all([
    o2q.getRecentYields(pairId, 24),
    o2q.getRecentRsTimestamps(pairId, Date.now() - 4 * 3600_000),
    o2q.getTrailingTxCount(pairId, Date.now() - 24 * 3600_000),
  ]);
  return { trailingYields, rsTimestamps, trailing24hGasUsd: txCount * gasCostEstimate };
}

function toBaseRange(p: RangeParams): ForceParams["baseRange"] {
  return { min: p.baseMin, max: p.baseMax, vforceExp: p.vforceExp, vforceDivider: p.vforceDivider };
}

/**
 * Run a single 5-step cycle for a pair.
 *
 * 1. RAW DATA: fetch M1 candles + pool snapshots (parallel)
 * 2. COMPUTE: forces + pool analysis + allocation
 * 3. STORE: persist pool_analysis + pair_allocation (O2)
 * 4. DECIDE: PRA / RS / HOLD (pure function)
 * 5. EXECUTE + LOG: if not HOLD
 */
export async function runSingleCycle(
  store: DragonflyStore,
  pair: PairConfig,
  privateKey: `0x${string}` | null,
): Promise<Decision> {
  const now = Date.now();
  const rt = getPair(pair.id);

  // ---- STEP 1: RAW DATA (parallel) ----
  const [newCandles, snapshots] = await Promise.all([
    fetchLatestM1(store, pair.id),
    fetchPoolSnapshots(pair.id, pair.pools, now),
  ]);

  // Append new candles to in-memory buffer and trim to 30 days
  if (rt && newCandles.length) {
    rt.candles.push(...newCandles);
    const cutoff = now - BACKFILL_MS;
    const firstKeep = rt.candles.findIndex((c) => c.ts >= cutoff);
    if (firstKeep > 0) rt.candles.splice(0, firstKeep);
  }

  if (!snapshots.length || snapshots.length < pair.pools.length * 0.5) {
    log.warn(
      `${pair.id}: insufficient snapshots (${snapshots.length}/${pair.pools.length}), holding`,
    );
    if (rt) { rt.currentApr = 0; rt.optimalApr = 0; }
    return {
      type: "HOLD",
      ts: now,
      currentApr: 0,
      optimalApr: 0,
      improvement: 0,
      targetAllocations: [],
    };
  }

  // ---- STEP 2: COMPUTE ----

  // 2a. Read M1 candles from in-memory buffer -> composite forces
  const m1Candles = rt?.candles ?? [];

  // Merge forceParams with defaults to avoid undefined fields
  const forceParams = mergeForceParams(pair.forceParams);

  // 2a.i REGIME CHECK: circuit breaker
  const epoch = await store.incrementEpoch();
  if (rt) rt.epoch = epoch;
  const suppressUntil = await store.getRegimeSuppressUntil();
  if (rt) rt.regimeSuppressUntil = suppressUntil;

  // Stable pair = both tokens are stablecoins
  const [t0, t1] = pair.id.split("-");
  const isStable =
    (STABLE_TOKENS as readonly string[]).includes(t0) &&
    (STABLE_TOKENS as readonly string[]).includes(t1);
  const regime = detectRegime(m1Candles, epoch, isStable);

  if (rt) rt.regime = regime;
  if (regime.suppressed) {
    await store.setRegimeSuppressUntil(regime.suppressUntilEpoch);
    if (rt) rt.regimeSuppressUntil = regime.suppressUntilEpoch;
    log.warn(
      `${pair.id}: regime circuit breaker — ${regime.reason}, suppressing optimizer for 4 epochs`,
    );
  }

  // 2a.ii OPTIMIZE: Nelder-Mead on 5 range params (skip if regime suppressed)
  // Pre-compute M15 candles once — reused by both optimizer and compositeForces
  const m15Candles = m1Candles.length > 10 ? aggregateCandles(m1Candles, 15) : [];
  let rsThreshold = forceParams.rsThreshold;
  if (m1Candles.length > 100 && epoch > suppressUntil) {
    try {
      const poolFee = snapshots[0]?.feePct ?? DEFAULT_FEE;
      const baseApr = snapshots[0]
        ? ((snapshots[0].volume24h * poolFee) / (snapshots[0].tvl || 1)) * 365.25
        : 0;
      const ctx: FitnessContext = {
        candles: m15Candles,
        baseApr,
        poolFee,
        gasCostUsd: GAS_COST_USD,
        positionValueUsd: POSITION_VALUE_USD,
      };

      // Kill-switch check: fallback to defaults if triggered
      const ksState = await buildKillSwitchState(pair.id, GAS_COST_USD);
      const opt = optimize(ctx, pair.id);
      const ks = checkKillSwitches(ksState, POSITION_VALUE_USD, opt.params);

      // Cache kill-switch state in runtime for API access
      if (rt) rt.killSwitch = ks.useDefaults ? { active: true, reason: ks.reason } : null;

      if (ks.useDefaults) {
        log.warn(`${pair.id}: kill-switch triggered (${ks.reason}), using default params`);
        const defaults = defaultRangeParams();
        forceParams.baseRange = toBaseRange(defaults);
        rsThreshold = defaults.rsThreshold;
        if (rt) {
          rt.optParams = defaults;
          rt.optFitness = 0;
        }
      } else {
        forceParams.baseRange = toBaseRange(opt.params);
        rsThreshold = opt.params.rsThreshold;
        if (rt) {
          rt.optParams = opt.params;
          rt.optFitness = opt.fitness;
        }
      }

      // Persist optimizer warm-start
      await store.saveOptimizerState(rangeParamsToVec(opt.params), opt.fitness);
      ingestToO2("optimizer_state", [
        { pairId: pair.id, ...opt.params, fitness: opt.fitness, evals: opt.evals },
      ]);
      log.debug(
        `${pair.id}: optimizer fitness=${opt.fitness.toFixed(6)} evals=${opt.evals} rs=${rsThreshold.toFixed(3)}`,
      );
    } catch (e: unknown) {
      log.error(`${pair.id}: optimizer failed (${errMsg(e)}), using defaults`);
      const defaults = defaultRangeParams();
      forceParams.baseRange = toBaseRange(defaults);
      rsThreshold = defaults.rsThreshold;
      if (rt) {
        rt.optParams = defaults;
        rt.optFitness = 0;
      }
    }
  }

  // Apply regime widen factor to both range width and decision thresholds
  if (regime.widenFactor > 1.0) {
    forceParams.baseRange.min *= regime.widenFactor;
    forceParams.baseRange.max *= regime.widenFactor;
    rsThreshold = Math.min(rsThreshold * regime.widenFactor, 0.9);
  }

  // Return neutral defaults for empty candles instead of NaN
  const forces =
    m1Candles.length > 10 ? compositeForces(m1Candles, forceParams, m15Candles) : NEUTRAL_FORCES;
  if (rt) rt.forces = forces;

  // 2b. Load previous snapshots from O2 for interval volume diffing
  const prevSnapshots = new Map<string, Awaited<ReturnType<typeof getLastSnapshot>>>();
  const prevResults = await Promise.all(
    snapshots.map((snap) => getLastSnapshot(snap.pool, snap.chain, snap.ts)),
  );
  for (let i = 0; i < snapshots.length; i++) {
    const key = `${snapshots[i].chain}:${snapshots[i].pool}`;
    prevSnapshots.set(key, prevResults[i]);
  }

  // 2c. Per-pool analysis
  const analyses = computePoolAnalyses(
    snapshots,
    prevSnapshots,
    pair.pools,
    forces,
    pair.intervalSec,
    now,
  );

  // 2d. Water-fill allocation (pass actual capital size for dilution model)
  const targetAllocations = waterFill(analyses, pair.pools, pair.maxPositions, POSITION_VALUE_USD);

  // ---- STEP 3: STORE (O2 only) ----
  const positions = await store.getPositions();
  ingestToO2(
    "pool_analyses",
    analyses.map((a) => ({ pairId: pair.id, ...a })),
  );

  // ---- STEP 4: DECIDE ----
  const price = m1Candles.length
    ? m1Candles[m1Candles.length - 1].c
    : snapshots[0]?.exchangeRate || 1;

  // Force HOLD during regime suppression to avoid decisions on stale optimizer params
  if (regime.suppressed) {
    log.info(`${pair.id}: HOLD (regime suppressed — ${regime.reason})`);
    if (rt) { rt.currentApr = 0; rt.optimalApr = 0; }
    const holdDecision: Decision = {
      type: "HOLD",
      ts: now,
      currentApr: 0,
      optimalApr: 0,
      improvement: 0,
      targetAllocations,
    };
    const pairAlloc = buildPairAllocation(holdDecision, positions);
    ingestToO2("pair_allocations", [
      {
        pairId: pair.id, ts: now, decision: "HOLD",
        currentApr: 0, optimalApr: 0, improvement: 0,
        targetAllocations: JSON.stringify(holdDecision.targetAllocations),
        currentAllocations: JSON.stringify(pairAlloc.currentAllocations),
      },
    ]);
    saveEpochSnapshot(pair.id, epoch, now, "HOLD", positions, price, 0, 0, 0);
    return holdDecision;
  }

  const praThreshold = regime.widenFactor > 1.0
    ? Math.min(pair.thresholds.pra * regime.widenFactor * 2, 0.9)
    : pair.thresholds.pra;
  const thresholds = { pra: praThreshold, rs: rsThreshold };
  const lastRebalTs =
    positions.length > 0 ? Math.max(...positions.map((p) => p.entryTs)) : undefined;
  const decision = decide(targetAllocations, positions, forces, price, thresholds, lastRebalTs, {
    gasCostUsd: GAS_COST_USD,
    positionValueUsd: POSITION_VALUE_USD,
  });

  // Update runtime state
  if (rt) {
    rt.lastDecision = decision.type;
    rt.lastDecisionTs = decision.ts;
    rt.currentApr = decision.currentApr;
    rt.optimalApr = decision.optimalApr;
  }

  // Save pair allocation (O2 only)
  const pairAlloc = buildPairAllocation(decision, positions);
  ingestToO2("pair_allocations", [
    {
      pairId: pair.id, ts: now, decision: decision.type,
      currentApr: decision.currentApr, optimalApr: decision.optimalApr,
      improvement: decision.improvement,
      targetAllocations: JSON.stringify(decision.targetAllocations),
      currentAllocations: JSON.stringify(pairAlloc.currentAllocations),
    },
  ]);

  // ---- STEP 5: EXECUTE + LOG ----
  let txCount = 0;
  if (privateKey && decision.type !== "HOLD") {
    if (decision.type === "PRA" && decision.targetAllocations.length) {
      txCount = await executePRA(store, pair, decision.targetAllocations, decision.type, privateKey, forces, price);
    } else if (decision.type === "RS" && decision.rangeShifts?.length) {
      txCount = await executeRS(store, pair, decision.rangeShifts, decision.type, privateKey);
    }
  }

  // ---- STEP 6: EPOCH SNAPSHOT (after execution for accurate gas data) ----
  saveEpochSnapshot(
    pair.id, epoch, now, decision.type, positions, price,
    decision.currentApr, decision.optimalApr, txCount,
  );

  return decision;
}

// Track active timers for graceful shutdown
const activeTimers = new Set<ReturnType<typeof setTimeout>>();

/**
 * Start the scheduler loop for a pair.
 */
export async function startPairLoop(
  store: DragonflyStore,
  pair: PairConfig,
  privateKey: `0x${string}` | null,
) {
  log.info(`Starting ${pair.id} — interval=${pair.intervalSec}s max_pos=${pair.maxPositions}`);

  // Load optimizer warm-start from DragonflyDB
  const saved = await store.getOptimizerState();
  if (saved) {
    setWarmStart(pair.id, saved.vec);
    log.debug(`${pair.id}: loaded optimizer warm-start (fitness=${saved.fitness.toFixed(6)})`);
  }

  // Restore epoch and regime state from DragonflyDB
  const rt = getPair(pair.id);
  if (rt) {
    rt.epoch = await store.getEpoch();
    rt.regimeSuppressUntil = await store.getRegimeSuppressUntil();
  }

  // Initial backfill — populate in-memory candle buffer
  const backfilledCandles = await backfill(store, pair.id);
  if (rt) rt.candles = backfilledCandles;

  // First cycle immediately
  try {
    const d = await runSingleCycle(store, pair, privateKey);
    log.info(`${pair.id}: ${d.type} — current=${pct(d.currentApr)} optimal=${pct(d.optimalApr)}`, {
      pairId: pair.id,
      decision: d.type,
    });
  } catch (e: unknown) {
    log.error(`${pair.id} cycle error: ${errMsg(e)}`, { pairId: pair.id });
  }

  // Recurring loop — setTimeout chaining (no overlap), prune fired timers
  const intervalMs = pair.intervalSec * 1000;
  function scheduleNext() {
    const t = setTimeout(async () => {
      activeTimers.delete(t);
      try {
        const d = await runSingleCycle(store, pair, privateKey);
        log.info(
          `${pair.id}: ${d.type} — current=${pct(d.currentApr)} optimal=${pct(d.optimalApr)}`,
          { pairId: pair.id, decision: d.type },
        );
      } catch (e: unknown) {
        log.error(`${pair.id} cycle error: ${errMsg(e)}`, { pairId: pair.id });
      }
      scheduleNext();
    }, intervalMs);
    activeTimers.add(t);
  }
  scheduleNext();
}

/**
 * Stop all scheduler loops (for graceful shutdown).
 */
export function stopAllLoops() {
  for (const t of activeTimers) clearTimeout(t);
  activeTimers.clear();
  log.info("All scheduler loops stopped");
}
