import type {
  PairConfig,
  StrategyConfig,
  Decision,
  ForceParams,
  RangeParams,
  Candle,
  PoolSnapshot,
} from "./types";
import type { DragonflyStore } from "./data/store-dragonfly";
import {
  DEFAULT_FORCE_PARAMS,
  DEFAULT_FEE,
  DEFAULT_CAPITAL_USD,
  STABLE_TOKENS,
  CANDLE_BUFFER_MS,
  SECONDS_PER_YEAR,
  HOUR_MS,
  DAY_MS,
  MTF_CANDLES,
  M15_MS,
  H1_MS,
  H4_MS,
  OPT_LOOKBACK_MS,
  CATCHUP_MAX_MS,
} from "./config/params";
import { fetchLatestM1, backfill, trimCandles } from "./data/ohlc";
import { fetchPoolSnapshots } from "./data/gecko";
import { getLastSnapshot } from "./data/store-o2";
import { readCollectedCandles, readCollectedSnapshots, readCollectedTs } from "./infra/redis";
import type { RedisClient } from "bun";
import * as o2q from "./data/store-o2";
import { compositeForces, computeForces, blendForces, NEUTRAL_FORCES } from "./strategy/forces";
import { computePoolAnalyses } from "./strategy/utilization";
import { computeRange } from "./strategy/range";
import { allocate } from "./strategy/allocation";
import { decide, buildPairAllocation } from "./strategy/decision";
import { executePRA, executeRS } from "./executor";
import { ingestToO2, flushO2 } from "./infra/o2";
import { fmtPct as pct, aggregateCandles } from "../shared/format";
import { log, errMsg, upperBound, computeIL, pairGasCost } from "./utils";
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

/** Ingest allocation decision to O2 (used by both HOLD and normal decision paths). */
function ingestAllocation(
  pairId: string,
  id: string,
  now: number,
  decision: Decision,
  positions: { pool: `0x${string}`; chain: number; dex: string; entryApr: number }[],
) {
  const pairAlloc = buildPairAllocation(decision, positions as any);
  ingestToO2("pair_allocations", [
    {
      pairId,
      strategyName: id,
      ts: now,
      decision: decision.type,
      currentApr: decision.currentApr,
      optimalApr: decision.optimalApr,
      improvement: decision.improvement,
      targetAllocations: JSON.stringify(decision.targetAllocations),
      currentAllocations: JSON.stringify(pairAlloc.currentAllocations),
    },
  ]);
}

/** Save epoch snapshot with computed PnL fields to O2. */
function saveEpochSnapshot(
  pairId: string,
  strategyName: string,
  epoch: number,
  ts: number,
  decision: string,
  positions: { entryPrice: number; entryValueUsd: number }[],
  currentPrice: number,
  currentApr: number,
  optimalApr: number,
  txCount: number,
  gasCostUsd: number,
  cycleSec: number,
) {
  const portfolioValueUsd = positions.reduce((sum, p) => sum + p.entryValueUsd, 0);
  const gasSpentUsd = txCount * gasCostUsd;
  const intervalsPerYear = SECONDS_PER_YEAR / cycleSec;
  const feesEarnedUsd =
    portfolioValueUsd > 0 ? (currentApr * portfolioValueUsd) / intervalsPerYear : 0;
  const ilUsd = computeIL(positions, currentPrice);
  const rangeEfficiency = optimalApr > 0 ? Math.min(currentApr / optimalApr, 1.0) : 0;
  const netPnlUsd = feesEarnedUsd - gasSpentUsd - ilUsd;

  ingestToO2("epoch_snapshots", [
    {
      pairId,
      strategyName,
      epoch,
      ts,
      decision,
      portfolioValueUsd,
      feesEarnedUsd,
      gasSpentUsd,
      ilUsd,
      netPnlUsd,
      rangeEfficiency,
      currentApr,
      optimalApr,
      positionsCount: positions.length,
    },
  ]);
}

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
  cycleSec: number,
): Promise<KillSwitchState> {
  const yieldCount = Math.ceil((6 * HOUR_MS) / (cycleSec * 1000));
  const [trailingYields, rsTimestamps, txCount] = await Promise.all([
    o2q.getRecentYields(pairId, yieldCount, cycleSec),
    o2q.getRecentRsTimestamps(pairId, Date.now() - 4 * HOUR_MS),
    o2q.getTrailingTxCount(pairId, Date.now() - DAY_MS),
  ]);
  return { trailingYields, rsTimestamps, trailing24hGasUsd: txCount * gasCostEstimate };
}

function toBaseRange(p: RangeParams): ForceParams["baseRange"] {
  return { min: p.baseMin, max: p.baseMax, vforceExp: p.vforceExp, vforceDivider: p.vforceDivider };
}

/** Reset optimizer params to defaults, returns rsThreshold. */
function applyDefaultParams(
  forceParams: ForceParams,
  rt: ReturnType<typeof getPair>,
): number {
  const defaults = defaultRangeParams();
  forceParams.baseRange = toBaseRange(defaults);
  if (rt) { rt.optParams = defaults; rt.optFitness = 0; }
  return defaults.rsThreshold;
}

/** Derive the entity ID used for runtime lookup (strategy name if available, else pair ID). */
function entityId(config: PairConfig | StrategyConfig): string {
  return "name" in config ? config.name : config.id;
}

/** Derive the pair ID from either config type. */
function pairIdOf(config: PairConfig | StrategyConfig): string {
  return "pairId" in config ? config.pairId : config.id;
}

/**
 * Run a single 5-step cycle for a strategy/pair.
 *
 * 1. RAW DATA: read from collector (shared DragonflyDB keys), fallback to direct fetch
 * 2. COMPUTE: forces + pool analysis + allocation
 * 3. STORE: persist pool_analysis + pair_allocation (O2)
 * 4. DECIDE: PRA / RS / HOLD (pure function)
 * 5. EXECUTE + LOG: if not HOLD
 */
export async function runSingleCycle(
  store: DragonflyStore,
  pair: PairConfig | StrategyConfig,
  privateKey: `0x${string}` | null,
  redis?: RedisClient,
): Promise<Decision> {
  const now = Date.now();
  const id = entityId(pair);
  const pairId = pairIdOf(pair);
  const rt = getPair(id);

  const pairGasCostUsd = pairGasCost(pair.pools);

  // ---- STEP 1: RAW DATA ----
  // Read from collector if available, otherwise fetch directly (standalone mode)
  let newCandles: Candle[];
  let snapshots: PoolSnapshot[];

  const collectorTs = redis ? await readCollectedTs(redis, pairId) : 0;
  const collectorFresh = collectorTs > 0 && now - collectorTs < pair.intervalSec * 2000;

  let useCollectorBuffer = false;
  if (redis && collectorFresh) {
    [newCandles, snapshots] = await Promise.all([
      readCollectedCandles(redis, pairId),
      readCollectedSnapshots(redis, pairId),
    ]);
    useCollectorBuffer = true;
  } else {
    // Fallback: direct fetch (standalone mode or stale collector)
    [newCandles, snapshots] = await Promise.all([
      fetchLatestM1(store, pairId),
      fetchPoolSnapshots(pairId, pair.pools, now),
    ]);
  }

  // Update in-memory candle buffer
  if (rt && newCandles.length) {
    if (useCollectorBuffer) {
      // Collector buffer is the full window — replace, don't append
      rt.candles = newCandles;
    } else {
      // Incremental fetch — append and trim
      rt.candles.push(...newCandles);
      trimCandles(rt.candles, now - CANDLE_BUFFER_MS);
    }
  }

  // ---- STEP 2: COMPUTE (always runs for display data) ----

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
  const [t0, t1] = pairId.split("-");
  const isStable =
    (STABLE_TOKENS as readonly string[]).includes(t0) &&
    (STABLE_TOKENS as readonly string[]).includes(t1);
  const regime = detectRegime(m1Candles, epoch, isStable);

  if (rt) rt.regime = regime;
  if (regime.suppressed) {
    await store.setRegimeSuppressUntil(regime.suppressUntilEpoch);
    if (rt) rt.regimeSuppressUntil = regime.suppressUntilEpoch;
    log.warn(
      `${id}: regime circuit breaker — ${regime.reason}, suppressing optimizer for 4 epochs`,
    );
  }

  // Load positions early — used for dynamic capital sizing and later for allocation
  const positions = await store.getPositions();
  const posValue = positions.reduce((s, p) => s + p.entryValueUsd, 0);
  const effectiveCapital = posValue > 0 ? posValue : DEFAULT_CAPITAL_USD;

  // 2a.ii OPTIMIZE: Nelder-Mead on 5 range params (skip if regime suppressed)
  // Pre-compute M15 candles once — reused by both optimizer and compositeForces
  const m15Candles = m1Candles.length > 10 ? aggregateCandles(m1Candles, M15_MS) : [];
  let rsThreshold = forceParams.rsThreshold;
  if (m1Candles.length > 100 && epoch > suppressUntil) {
    try {
      const poolFee = snapshots[0]?.feePct ?? DEFAULT_FEE;
      const baseApr = snapshots[0]
        ? ((snapshots[0].volume24h * poolFee) / (snapshots[0].tvl || 1)) * 365.25
        : 0;
      const optCandles = m15Candles.filter(c => c.ts >= now - OPT_LOOKBACK_MS);
      const ctx: FitnessContext = {
        candles: optCandles,
        baseApr,
        poolFee,
        gasCostUsd: pairGasCostUsd,
        positionValueUsd: effectiveCapital,
      };

      // Kill-switch check: fallback to defaults if triggered
      const ksState = await buildKillSwitchState(pairId, pairGasCostUsd, pair.intervalSec);
      const opt = optimize(ctx, id);
      const ks = checkKillSwitches(ksState, effectiveCapital, opt.params, pair.intervalSec);

      // Cache kill-switch state in runtime for API access
      if (rt) rt.killSwitch = ks.useDefaults ? { active: true, reason: ks.reason } : null;

      if (ks.useDefaults) {
        log.warn(`${id}: kill-switch triggered (${ks.reason}), using default params`);
        rsThreshold = applyDefaultParams(forceParams, rt);
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
        {
          pairId,
          strategyName: id,
          ...opt.params,
          fitness: opt.fitness,
          evals: opt.evals,
          forceParams: {
            volatility: forceParams.volatility,
            momentum: forceParams.momentum,
            trend: forceParams.trend,
            confidence: forceParams.confidence,
            baseRange: forceParams.baseRange,
            rsThreshold,
            regimeWidenFactor: regime.widenFactor,
          },
        },
      ]);
      log.debug(
        `${id}: optimizer fitness=${opt.fitness.toFixed(6)} evals=${opt.evals} rs=${rsThreshold.toFixed(3)}`,
      );
    } catch (e: unknown) {
      log.error(`${id}: optimizer failed (${errMsg(e)}), using defaults`);
      rsThreshold = applyDefaultParams(forceParams, rt);
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

  // ---- STEP 3: STORE (O2 only) ----

  // 2d. C-Score allocation (power-law weights with capital-aware diversification)
  const targetAllocations = allocate(analyses, pair.pools, pair.maxPositions, effectiveCapital);

  // Cache optimal ranges from analyses for API fallback
  if (rt) {
    rt.optimalRanges = analyses
      .filter((a) => a.rangeMin > 0 && a.rangeMax > 0)
      .map((a) => ({
        pool: a.pool,
        chain: a.chain,
        rangeMin: a.rangeMin,
        rangeMax: a.rangeMax,
        confidence: a.rangeConfidence,
        ts: a.ts,
      }));
  }
  ingestToO2(
    "pool_analyses",
    analyses.map((a) => ({ pairId, strategyName: id, ...a })),
  );

  // ---- STEP 4: DECIDE ----
  const price = m1Candles.length
    ? m1Candles[m1Candles.length - 1].c
    : snapshots[0]?.exchangeRate || 1;

  // Force HOLD during regime suppression to avoid decisions on stale optimizer params
  if (regime.suppressed) {
    log.info(`${id}: HOLD (regime suppressed — ${regime.reason})`);
    if (rt) {
      rt.currentApr = 0;
      rt.optimalApr = 0;
    }
    const holdDecision: Decision = {
      type: "HOLD",
      ts: now,
      currentApr: 0,
      optimalApr: 0,
      improvement: 0,
      targetAllocations,
    };
    ingestAllocation(pairId, id, now, holdDecision, positions);
    saveEpochSnapshot(pairId, id, epoch, now, "HOLD", positions, price, 0, 0, 0, pairGasCostUsd, pair.intervalSec);
    return holdDecision;
  }

  const praThreshold =
    regime.widenFactor > 1.0
      ? Math.min(pair.thresholds.pra * regime.widenFactor * 2, 0.9)
      : pair.thresholds.pra;
  const thresholds = { pra: praThreshold, rs: rsThreshold };
  const lastRebalTs =
    positions.length > 0 ? Math.max(...positions.map((p) => p.entryTs)) : undefined;
  const decision = decide(targetAllocations, positions, forces, price, thresholds, lastRebalTs, {
    gasCostUsd: pairGasCostUsd,
    positionValueUsd: effectiveCapital,
  });

  // Update runtime state
  if (rt) {
    rt.lastDecision = decision.type;
    rt.lastDecisionTs = decision.ts;
    rt.currentApr = decision.currentApr;
    rt.optimalApr = decision.optimalApr;
    rt.targetAllocations = decision.targetAllocations;
  }

  ingestAllocation(pairId, id, now, decision, positions);

  // ---- STEP 5: EXECUTE + LOG ----
  let txCount = 0;
  if (privateKey && decision.type !== "HOLD") {
    if (decision.type === "PRA" && decision.targetAllocations.length) {
      txCount = await executePRA(
        store,
        pair as PairConfig,
        decision.targetAllocations,
        decision.type,
        privateKey,
        forces,
        price,
      );
    } else if (decision.type === "RS" && decision.rangeShifts?.length) {
      txCount = await executeRS(
        store,
        pair as PairConfig,
        decision.rangeShifts,
        decision.type,
        privateKey,
      );
    }
  }

  // ---- STEP 6: EPOCH SNAPSHOT (after execution for accurate gas data) ----
  saveEpochSnapshot(
    pairId,
    id,
    epoch,
    now,
    decision.type,
    positions,
    price,
    decision.currentApr,
    decision.optimalApr,
    txCount,
    pairGasCostUsd,
    pair.intervalSec,
  );

  return decision;
}

const INGEST_BATCH = 200;

async function catchUpStrategyData(
  pairId: string,
  id: string,
  candles: Candle[],
  pair: PairConfig | StrategyConfig,
) {
  if (candles.length < 100) return;
  const now = Date.now();
  const stepMs = pair.intervalSec * 1000;

  // Gap-aware: query O2 for latest epoch_snapshot timestamp
  const recent = await o2q.getEpochSnapshots(pairId, now - CATCHUP_MAX_MS, now, 1);
  let catchUpStart: number;
  if (recent.length > 0) {
    const latestTs = recent[recent.length - 1].ts;
    // If latest is recent enough, skip catch-up
    if (now - latestTs < 2 * stepMs) {
      log.info(`${id}: strategy catch-up skipped — recent epoch data in O2`);
      return;
    }
    catchUpStart = latestTs + stepMs;
  } else {
    catchUpStart = now - CATCHUP_MAX_MS;
  }

  const forceParams = mergeForceParams(pair.forceParams);

  // Pre-aggregate all timeframes once
  const allM15 = aggregateCandles(candles, M15_MS);
  const allH1 = aggregateCandles(candles, H1_MS);
  const allH4 = aggregateCandles(allH1, H4_MS);

  const pairGasCostUsd = pairGasCost(pair.pools);

  let allocBatch: Record<string, unknown>[] = [];
  let epochBatch: Record<string, unknown>[] = [];
  let optBatch: Record<string, unknown>[] = [];
  let syntheticEpoch = 0;
  let totalSteps = 0;

  for (let ts = catchUpStart; ts <= now; ts += stepMs) {
    // Yield every 10 steps so heartbeats + signals can fire
    if (totalSteps > 0 && totalSteps % 10 === 0) await new Promise((r) => setTimeout(r, 0));

    const m15End = upperBound(allM15, ts);
    const h1End = upperBound(allH1, ts);
    const h4End = upperBound(allH4, ts);
    if (m15End < 2) continue;

    const m15Slice = allM15.slice(Math.max(0, m15End - MTF_CANDLES.m15), m15End);
    const h1Slice = allH1.slice(Math.max(0, h1End - MTF_CANDLES.h1), h1End);
    const h4Slice = allH4.slice(Math.max(0, h4End - MTF_CANDLES.h4), h4End);

    const forces = blendForces([
      computeForces(m15Slice, forceParams),
      computeForces(h1Slice, forceParams),
      computeForces(h4Slice, forceParams),
    ]);
    const closingPrice = m15Slice[m15Slice.length - 1].c;
    const range = computeRange(closingPrice, forces, forceParams);

    // Run optimizer on M15 candles up to this point
    const optM15 = allM15.slice(0, m15End);
    let optParams = defaultRangeParams();
    let optFitness = 0;
    let optEvals = 0;
    if (optM15.length >= 20) {
      const fitCtx: FitnessContext = {
        candles: optM15,
        baseApr: 0,
        poolFee: DEFAULT_FEE,
        gasCostUsd: pairGasCostUsd,
        positionValueUsd: DEFAULT_CAPITAL_USD,
      };
      const opt = optimize(fitCtx, id);
      optParams = opt.params;
      optFitness = opt.fitness;
      optEvals = opt.evals;
    }

    // Build synthetic pool analyses for allocation
    const synthAnalyses = pair.pools.map((pool) => ({
      pool: pool.address,
      chain: pool.chain,
      ts,
      intervalVolume: 0,
      feePct: 0,
      feesGenerated: 0,
      tvl: 0,
      utilization: 0,
      apr: 0,
      exchangeRate: closingPrice,
      basePriceUsd: 1,
      vforce: forces.v.force,
      mforce: forces.m.force,
      tforce: forces.t.force,
      rangeMin: range.min,
      rangeMax: range.max,
      rangeBreadth: range.breadth,
      rangeBias: range.trendBias,
      rangeConfidence: range.confidence,
    }));

    const targetAllocations = allocate(synthAnalyses as any, pair.pools, pair.maxPositions, DEFAULT_CAPITAL_USD);

    allocBatch.push({
      _timestamp: new Date(ts).toISOString(),
      pairId,
      strategyName: id,
      ts,
      decision: "HOLD",
      currentApr: 0,
      optimalApr: 0,
      improvement: 0,
      targetAllocations: JSON.stringify(targetAllocations),
      currentAllocations: JSON.stringify([]),
    });

    epochBatch.push({
      _timestamp: new Date(ts).toISOString(),
      pairId,
      strategyName: id,
      epoch: syntheticEpoch++,
      ts,
      decision: "HOLD",
      portfolioValueUsd: 0,
      feesEarnedUsd: 0,
      gasSpentUsd: 0,
      ilUsd: 0,
      netPnlUsd: 0,
      rangeEfficiency: 0,
      currentApr: 0,
      optimalApr: 0,
      positionsCount: 0,
    });

    optBatch.push({
      _timestamp: new Date(ts).toISOString(),
      pairId,
      strategyName: id,
      ts,
      ...optParams,
      fitness: optFitness,
      evals: optEvals,
    });

    totalSteps++;

    if (allocBatch.length >= INGEST_BATCH) {
      ingestToO2("pair_allocations", allocBatch);
      ingestToO2("epoch_snapshots", epochBatch);
      ingestToO2("optimizer_state", optBatch);
      allocBatch = [];
      epochBatch = [];
      optBatch = [];
      await flushO2();
    }
  }

  // Flush remaining
  if (allocBatch.length) {
    ingestToO2("pair_allocations", allocBatch);
    ingestToO2("epoch_snapshots", epochBatch);
    ingestToO2("optimizer_state", optBatch);
    await flushO2();
  }

  if (totalSteps) {
    log.info(
      `${id}: strategy catch-up — ${totalSteps} steps (allocations + epochs + optimizer)`,
    );
  }
}

// Track active timers for graceful shutdown
const activeTimers = new Set<ReturnType<typeof setTimeout>>();

/**
 * Start the scheduler loop for a strategy/pair.
 * When redis is provided, reads collected data from shared keys (orchestrated mode).
 * Without redis, falls back to direct data fetching (standalone mode).
 */
export async function startPairLoop(
  store: DragonflyStore,
  pair: PairConfig | StrategyConfig,
  privateKey: `0x${string}` | null,
  redis?: RedisClient,
) {
  const id = entityId(pair);
  const pairId = pairIdOf(pair);
  log.info(
    `Starting ${id} (pair=${pairId}) — interval=${pair.intervalSec}s max_pos=${pair.maxPositions}`,
  );

  // Load optimizer warm-start from DragonflyDB
  const saved = await store.getOptimizerState();
  if (saved) {
    setWarmStart(id, saved.vec);
    log.debug(`${id}: loaded optimizer warm-start (fitness=${(saved.fitness ?? 0).toFixed(6)})`);
  }

  // Restore epoch and regime state from DragonflyDB
  const rt = getPair(id);
  if (rt) {
    rt.epoch = await store.getEpoch();
    rt.regimeSuppressUntil = await store.getRegimeSuppressUntil();
  }

  // Initial backfill — populate in-memory candle buffer
  // In orchestrated mode, try collector's shared buffer first (avoids duplicate CCXT calls)
  let backfilledCandles: Candle[] = [];
  if (redis) {
    backfilledCandles = await readCollectedCandles(redis, pairId);
    if (backfilledCandles.length) {
      log.info(`${id}: loaded ${backfilledCandles.length} candles from collector buffer`);
    }
  }
  if (!backfilledCandles.length) {
    backfilledCandles = await backfill(store, pairId);
  }
  if (rt) rt.candles = backfilledCandles;

  // Catch-up: backfill allocations + epoch snapshots from last 24h
  await catchUpStrategyData(pairId, id, backfilledCandles, pair);

  // First cycle immediately
  try {
    const d = await runSingleCycle(store, pair, privateKey, redis);
    log.info(`${id}: ${d.type} — current=${pct(d.currentApr)} optimal=${pct(d.optimalApr)}`, {
      pairId,
      decision: d.type,
    });
  } catch (e: unknown) {
    log.error(`${id} cycle error: ${errMsg(e)}`, { pairId });
  }

  // Recurring loop — setTimeout chaining (no overlap), prune fired timers
  const intervalMs = pair.intervalSec * 1000;
  function scheduleNext() {
    const t = setTimeout(async () => {
      activeTimers.delete(t);
      try {
        const d = await runSingleCycle(store, pair, privateKey, redis);
        log.info(`${id}: ${d.type} — current=${pct(d.currentApr)} optimal=${pct(d.optimalApr)}`, {
          pairId,
          decision: d.type,
        });
      } catch (e: unknown) {
        log.error(`${id} cycle error: ${errMsg(e)}`, { pairId });
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
