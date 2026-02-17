import type { Database } from "bun:sqlite";
import type { PairConfig, Decision, Forces, ForceParams, RangeParams } from "./types";
import {
  DEFAULT_FORCE_PARAMS,
  DEFAULT_FEE,
  GAS_COST_USD,
  POSITION_VALUE_USD,
  STABLE_TOKENS,
  BACKFILL_MS,
} from "./config/params";
import { fetchLatestM1, backfill } from "./data/ohlc";
import { fetchPoolSnapshots } from "./data/gecko";
import {
  getCandles,
  getLastSnapshot,
  savePoolAnalyses,
  savePairAllocation,
  saveEpochSnapshot,
  getPositions,
  getOptimizerState,
  saveOptimizerState,
  getRecentYields,
  getRecentRsTimestamps,
  getTrailingTxCount,
} from "./data/store";
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

/** Build kill-switch state from DB queries */
function buildKillSwitchState(db: Database, gasCostEstimate: number): KillSwitchState {
  const trailingYields = getRecentYields(db, 24);
  const rsTimestamps = getRecentRsTimestamps(db, Date.now() - 4 * 3600_000);
  const txCount = getTrailingTxCount(db, Date.now() - 24 * 3600_000);
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
 * 3. STORE: persist pool_analysis + pair_allocation
 * 4. DECIDE: PRA / RS / HOLD (pure function)
 * 5. EXECUTE + LOG: if not HOLD
 */
export async function runSingleCycle(
  db: Database,
  pair: PairConfig,
  privateKey: `0x${string}` | null,
): Promise<Decision> {
  const now = Date.now();
  const rt = getPair(pair.id);

  // ---- STEP 1: RAW DATA (parallel) ----
  const [, snapshots] = await Promise.all([
    fetchLatestM1(db, pair.id),
    fetchPoolSnapshots(db, pair.pools, now),
  ]);

  if (snapshots.length) {
    ingestToO2(
      "pool_snapshots",
      snapshots.map((s) => ({ pairId: pair.id, ...s })),
    );
  }

  if (!snapshots.length) {
    log.warn(`${pair.id}: no snapshots available`);
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

  // 2a. Load 30d of M1 candles from DB -> composite forces
  const m1Since = now - BACKFILL_MS;
  const m1Candles = getCandles(db, m1Since, now);

  // Merge forceParams with defaults to avoid undefined fields
  const forceParams = mergeForceParams(pair.forceParams);

  // 2a.i REGIME CHECK: circuit breaker
  if (rt) rt.epoch++;
  const epoch = rt?.epoch ?? 1;
  const suppressUntil = rt?.regimeSuppressUntil ?? 0;

  // Stable pair = both tokens are stablecoins
  const [t0, t1] = pair.id.split("-");
  const isStable =
    (STABLE_TOKENS as readonly string[]).includes(t0) &&
    (STABLE_TOKENS as readonly string[]).includes(t1);
  const regime = detectRegime(m1Candles, epoch, isStable);

  if (rt) rt.regime = regime;
  if (regime.suppressed && rt) {
    rt.regimeSuppressUntil = regime.suppressUntilEpoch;
    log.warn(
      `${pair.id}: regime circuit breaker — ${regime.reason}, suppressing optimizer for 4 epochs`,
    );
  }

  // 2a.ii OPTIMIZE: Nelder-Mead on 5 range params (skip if regime suppressed)
  // Pre-compute M15 candles once — reused by both optimizer and compositeForces
  const m15Candles = m1Candles.length > 10 ? aggregateCandles(m1Candles, 15) : [];
  let rsThreshold = forceParams.rsThreshold;
  if (m1Candles.length > 100 && epoch > suppressUntil) {
    const poolFee = snapshots[0]?.feePct || DEFAULT_FEE;
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
    const ksState = buildKillSwitchState(db, GAS_COST_USD);
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
    saveOptimizerState(db, pair.id, rangeParamsToVec(opt.params), opt.fitness);
    ingestToO2("optimizer_state", [
      { pairId: pair.id, ...opt.params, fitness: opt.fitness, evals: opt.evals },
    ]);
    log.debug(
      `${pair.id}: optimizer fitness=${opt.fitness.toFixed(6)} evals=${opt.evals} rs=${rsThreshold.toFixed(3)}`,
    );
  }

  // Apply regime widen factor
  if (regime.widenFactor > 1.0) {
    forceParams.baseRange.min *= regime.widenFactor;
    forceParams.baseRange.max *= regime.widenFactor;
  }

  // Return neutral defaults for empty candles instead of NaN
  const forces =
    m1Candles.length > 10 ? compositeForces(m1Candles, forceParams, m15Candles) : NEUTRAL_FORCES;
  if (rt) rt.forces = forces;

  // 2b. Load previous snapshots for interval volume diffing
  const prevSnapshots = new Map<string, ReturnType<typeof getLastSnapshot>>();
  for (const snap of snapshots) {
    const key = `${snap.chain}:${snap.pool}`;
    prevSnapshots.set(key, getLastSnapshot(db, snap.pool, snap.chain, snap.ts));
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

  // ---- STEP 3: STORE ----
  const positions = getPositions(db);
  savePoolAnalyses(db, analyses);
  ingestToO2(
    "pool_analyses",
    analyses.map((a) => ({ pairId: pair.id, ...a })),
  );

  // ---- STEP 4: DECIDE ----
  const price = m1Candles.length
    ? m1Candles[m1Candles.length - 1].c
    : snapshots[0]?.exchangeRate || 1;
  const thresholds = { pra: pair.thresholds.pra, rs: rsThreshold };
  const lastRebalTs =
    positions.length > 0 ? Math.max(...positions.map((p) => p.entryTs)) : undefined;
  const decision = decide(targetAllocations, positions, forces, price, thresholds, lastRebalTs);

  // Update runtime state
  if (rt) {
    rt.lastDecision = decision.type;
    rt.lastDecisionTs = decision.ts;
  }

  // Save pair allocation
  const pairAlloc = buildPairAllocation(decision, positions);
  savePairAllocation(db, pairAlloc);
  ingestToO2("pair_allocations", [
    {
      pairId: pair.id,
      decision: decision.type,
      currentApr: decision.currentApr,
      optimalApr: decision.optimalApr,
      improvement: decision.improvement,
      targetAllocations: JSON.stringify(decision.targetAllocations),
      currentAllocations: JSON.stringify(pairAlloc.currentAllocations),
    },
  ]);

  // Save epoch snapshot
  const epochSnap = {
    pairId: pair.id,
    epoch,
    ts: now,
    decision: decision.type,
    portfolioValueUsd: positions.reduce((sum, p) => sum + p.entryValueUsd, 0),
    feesEarnedUsd: 0,
    gasSpentUsd: 0,
    ilUsd: 0,
    netPnlUsd: 0,
    rangeEfficiency: 0,
    currentApr: decision.currentApr,
    optimalApr: decision.optimalApr,
    positionsCount: positions.length,
  };
  saveEpochSnapshot(db, epochSnap);
  ingestToO2("epoch_snapshots", [epochSnap]);

  // ---- STEP 5: EXECUTE + LOG ----
  if (privateKey && decision.type !== "HOLD") {
    if (decision.type === "PRA" && decision.targetAllocations.length) {
      await executePRA(db, pair, decision.targetAllocations, decision.type, privateKey, forces);
    } else if (decision.type === "RS" && decision.rangeShifts?.length) {
      await executeRS(db, pair, decision.rangeShifts, decision.type, privateKey);
    }
  }

  return decision;
}

// Track active timers for graceful shutdown
const activeTimers = new Set<ReturnType<typeof setTimeout>>();

/**
 * Start the scheduler loop for a pair.
 */
export async function startPairLoop(
  db: Database,
  pair: PairConfig,
  privateKey: `0x${string}` | null,
) {
  log.info(`Starting ${pair.id} — interval=${pair.intervalSec}s max_pos=${pair.maxPositions}`);

  // Load optimizer warm-start from DB
  const saved = getOptimizerState(db, pair.id);
  if (saved) {
    setWarmStart(pair.id, saved.vec);
    log.debug(`${pair.id}: loaded optimizer warm-start (fitness=${saved.fitness.toFixed(6)})`);
  }

  // Initial backfill
  await backfill(db, pair.id);

  // First cycle immediately
  try {
    const d = await runSingleCycle(db, pair, privateKey);
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
        const d = await runSingleCycle(db, pair, privateKey);
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
