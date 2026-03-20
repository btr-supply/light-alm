import type { AllocationEntry, PoolAnalysis, PoolConfig, DexId } from "../types";
import { ALLOC_MIN_PCT } from "../config/params";
import { fmtPct as pct } from "../../shared/format";
import { log } from "../utils";

// ---- Weight Model (aligned with risk-ui / LibRisk.sol) ----

const BPS = 10_000;

/** Default weight model params (from risk-ui defaultWeightModel) */
export const WEIGHT_MODEL = {
  scoreAmplifierBp: 15_000, // 1.5x power-law exponent
  minMaxBp: 2_500, // 25% minimum cap per pool (count-based)
  maxBp: BPS, // 100% absolute ceiling
  diversificationFactorBp: 3_000, // 0.3 decay factor
  minPools: 2, // enforce at least 2 pools in allocation
  // Capital-based diversification: maxWeight decreases as totalCapitalUsd grows
  // capitalCap = capitalFloorBp + capitalDecayBp * exp(-capital / capitalHalfLifeUsd)
  capitalFloorBp: 800, // 8% absolute minimum per pool at high capital
  capitalDecayBp: 5_000, // 50% decay range (floor + decay = 58% at zero capital)
  capitalHalfLifeUsd: 750_000, // $750k: at this capital, decay ≈ 37% of range
} as const;

/**
 * Compute per-pool composite score from APR and TVL.
 *
 * Maps to risk-ui's C-Score concept (geometric mean of multiple dimensions).
 * Here our dimensions are:
 *   - yieldScore:    pool APR vs best APR in the set (0–BPS)
 *   - liquidityScore: pool TVL vs best TVL in the set (0–BPS)
 *
 * Both dimensions are normalized to [0, BPS] against their respective maximums,
 * ensuring symmetric scoring without pool-count bias.
 *
 * cScore = sqrt(yieldScore * liquidityScore) (geometric mean of 2 dims)
 */
function poolCScore(apr: number, tvl: number, maxApr: number, maxTvl: number): number {
  if (maxApr <= 0 || maxTvl <= 0) return 0;
  const yieldScore = Math.min((apr / maxApr) * BPS, BPS);
  const liquidityScore = Math.min((tvl / maxTvl) * BPS, BPS);
  const product = (yieldScore / BPS) * (liquidityScore / BPS);
  return Math.round(Math.sqrt(product) * BPS);
}

/**
 * Dynamic max weight per pool based on pool count AND total capital.
 *
 * Two independent risk constraints (the tighter one governs):
 *   countCap   = minMaxBp + exp(-n * diversificationFactor) * BPS   (from risk-ui)
 *   capitalCap = capitalFloorBp + capitalDecayBp * exp(-capital / halfLife)
 *
 * Rationale: diversification need increases with TVL.  A $10k portfolio can
 * tolerate 50%+ in one pool; a $1M portfolio should cap at ~20%; $10M+ at <10%.
 */
export function maxWeightBp(poolCount: number, totalCapitalUsd?: number): number {
  // Pool-count-based cap (existing risk-ui formula)
  const factor = WEIGHT_MODEL.diversificationFactorBp / BPS;
  const countDecay = Math.exp(-poolCount * factor);
  const countCap = WEIGHT_MODEL.minMaxBp + Math.round(countDecay * BPS);

  // Capital-based cap (new): only applied when capital is known
  let capitalCap = WEIGHT_MODEL.maxBp;
  if (totalCapitalUsd != null && totalCapitalUsd > 0) {
    const capDecay = Math.exp(-totalCapitalUsd / WEIGHT_MODEL.capitalHalfLifeUsd);
    capitalCap = WEIGHT_MODEL.capitalFloorBp + Math.round(WEIGHT_MODEL.capitalDecayBp * capDecay);
  }

  // Feasibility floor: cap must allow n pools to sum to BPS (equal-weight minimum).
  // Without this, the iterative capping loop cannot converge when n * cap < BPS.
  const feasibleFloor = poolCount > 0 ? Math.ceil(BPS / poolCount) : BPS;

  return Math.max(Math.min(countCap, capitalCap, WEIGHT_MODEL.maxBp), feasibleFloor);
}

/**
 * Compute target weights from C-Scores using power-law amplification
 * with iterative capping and redistribution (mirrors risk-ui targetWeights).
 */
function targetWeights(cScores: number[], totalCapitalUsd?: number): number[] {
  const n = cScores.length;
  if (n === 0) return [];

  const amplifier = WEIGHT_MODEL.scoreAmplifierBp / BPS;

  // Power-law raw weights
  const rawWeights = cScores.map((s) => (s === 0 ? 0 : Math.pow(s / BPS, amplifier)));
  const totalRaw = rawWeights.reduce((s, w) => s + w, 0);
  if (totalRaw === 0) return new Array(n).fill(0);

  // Normalize to BPS total
  let weights = rawWeights.map((w) => (w / totalRaw) * BPS);

  // Iterative capping with redistribution (up to 10 rounds, per risk-ui)
  const cap = maxWeightBp(n, totalCapitalUsd);
  const maxWeight = (cap / BPS) * BPS;

  for (let iter = 0; iter < 10; iter++) {
    let totalExcess = 0;
    const cappedSet = new Set<number>();

    for (let i = 0; i < n; i++) {
      if (weights[i] > maxWeight) {
        totalExcess += weights[i] - maxWeight;
        weights[i] = maxWeight;
        cappedSet.add(i);
      }
    }
    if (totalExcess === 0) break;

    // Redistribute proportionally to uncapped pools
    let uncappedTotal = 0;
    const uncappedIndices: number[] = [];
    for (let i = 0; i < n; i++) {
      if (!cappedSet.has(i) && weights[i] < maxWeight) {
        uncappedIndices.push(i);
        uncappedTotal += weights[i];
      }
    }
    if (uncappedTotal === 0) break;

    for (const i of uncappedIndices) {
      weights[i] += totalExcess * (weights[i] / uncappedTotal);
    }
  }

  // Round and fix rounding error
  weights = weights.map((w) => Math.round(w));
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum !== BPS && weights.length > 0) {
    const maxIdx = weights.indexOf(Math.max(...weights));
    weights[maxIdx] += BPS - sum;
  }

  return weights;
}

/**
 * C-Score allocation optimizer.
 *
 * Replaces water-fill with risk-ui's C-Score model:
 * 1. Score each pool via geometric mean of yield + liquidity
 * 2. Power-law weight amplification (exponent = scoreAmplifierBp / BPS)
 * 3. Dynamic max weight cap (exponential decay with pool count AND capital size)
 * 4. Iterative capping with redistribution
 * 5. Minimum 2-pool enforcement
 *
 * Expected APR per pool uses dilution model: apr * tvl / (tvl + pct * capitalUsd)
 *
 * @param totalCapitalUsd  Total portfolio value in USD.  When provided, the
 *   max-weight cap per pool decreases with capital (diversification need
 *   increases with TVL).  Pass undefined to use pool-count-only capping.
 */
export function allocate(
  analyses: PoolAnalysis[],
  pools: PoolConfig[],
  maxPositions: number,
  totalCapitalUsd?: number,
): AllocationEntry[] {
  // Take top N pools by APR, include all pools with snapshots (even APR=0 for diversification)
  const candidates = analyses.slice(0, maxPositions);
  if (!candidates.length) return [];

  const poolMap = new Map(pools.map((p) => [`${p.chain}:${p.address}`, p]));
  const poolLookup = (a: PoolAnalysis) => poolMap.get(`${a.chain}:${a.pool}`);

  // Compute scoring inputs
  const maxApr = Math.max(...candidates.map((a) => a.apr), 0);
  const maxTvl = Math.max(...candidates.map((a) => a.tvl), 0);

  // C-Scores for each pool
  const cScores = candidates.map((a) => poolCScore(a.apr, a.tvl, maxApr, maxTvl));

  // Enforce minimum pool count: if only 1 pool has data but we have more candidates,
  // give the zero-score pools a floor score so they get a small allocation
  const nonZero = cScores.filter((s) => s > 0).length;
  if (nonZero > 0 && nonZero < WEIGHT_MODEL.minPools && candidates.length >= WEIGHT_MODEL.minPools) {
    const floorScore = Math.round(Math.min(...cScores.filter((s) => s > 0)) * 0.1);
    for (let i = 0; i < cScores.length && i < WEIGHT_MODEL.minPools; i++) {
      if (cScores[i] === 0) cScores[i] = Math.max(floorScore, 100); // minimum 1% score
    }
  }

  // Filter to pools with non-zero scores
  const scored = candidates
    .map((a, i) => ({ analysis: a, score: cScores[i], idx: i }))
    .filter((s) => s.score > 0);

  if (!scored.length) return [];

  // Compute weights (capital-aware diversification when totalCapitalUsd provided)
  const weights = targetWeights(scored.map((s) => s.score), totalCapitalUsd);

  // Build allocations, tracking dropped indices for min-pool recovery
  let allocations: AllocationEntry[] = [];
  const dropped: number[] = [];
  for (let i = 0; i < scored.length; i++) {
    const w = weights[i] / BPS;
    if (w < ALLOC_MIN_PCT) { dropped.push(i); continue; }
    const a = scored[i].analysis;
    const p = poolLookup(a);
    allocations.push({
      pool: a.pool,
      chain: a.chain,
      dex: p?.dex ?? ("" as DexId),
      pct: w,
      expectedApr: a.apr, // dilution applied after weight finalization
    });
  }

  // Min-pool recovery: if filtering dropped below minPools, re-include best dropped pools
  if (allocations.length > 0 && allocations.length < WEIGHT_MODEL.minPools && dropped.length > 0) {
    const needed = WEIGHT_MODEL.minPools - allocations.length;
    const recover = dropped
      .sort((a, b) => (weights[b] ?? 0) - (weights[a] ?? 0))
      .slice(0, needed);
    for (const idx of recover) {
      const a = scored[idx].analysis;
      const p = poolLookup(a);
      allocations.push({
        pool: a.pool,
        chain: a.chain,
        dex: p?.dex ?? ("" as DexId),
        pct: ALLOC_MIN_PCT,
        expectedApr: a.apr, // dilution applied after weight finalization
      });
    }
  }

  // Normalize to sum=1 (should already be ≈1, but guard rounding)
  let total = allocations.reduce((s, a) => s + a.pct, 0);
  if (total > 0 && Math.abs(total - 1) > 0.001) {
    for (const a of allocations) a.pct /= total;
  }

  // Re-enforce cap after normalization (normalization can push weights above cap)
  const capPct = maxWeightBp(allocations.length, totalCapitalUsd) / BPS;
  let excess = 0;
  for (const a of allocations) {
    if (a.pct > capPct) { excess += a.pct - capPct; a.pct = capPct; }
  }
  if (excess > 0) {
    const uncapped = allocations.filter((a) => a.pct < capPct);
    const uncappedSum = uncapped.reduce((s, a) => s + a.pct, 0);
    if (uncappedSum > 0) {
      for (const a of uncapped) a.pct += excess * (a.pct / uncappedSum);
    }
  }

  // Apply dilution model: our capital added to a pool reduces per-LP APR
  // dilutedApr = apr × tvl / (tvl + allocationPct × totalCapital)
  if (totalCapitalUsd != null && totalCapitalUsd > 0) {
    const analysisMap = new Map(candidates.map((a) => [`${a.chain}:${a.pool}`, a]));
    for (const alloc of allocations) {
      const a = analysisMap.get(`${alloc.chain}:${alloc.pool}`);
      if (a && a.tvl > 0) {
        alloc.expectedApr = a.apr * a.tvl / (a.tvl + alloc.pct * totalCapitalUsd);
      }
    }
  }

  log.debug(
    `Allocate [${scored.length} pools, cap=${pct(maxWeightBp(scored.length, totalCapitalUsd) / BPS)}${totalCapitalUsd != null ? ` capital=$${(totalCapitalUsd / 1000).toFixed(0)}k` : ""}]: ${allocations.map((a) => `${a.pool.slice(0, 10)}=${pct(a.pct)} @${pct(a.expectedApr)}`).join(", ")}`,
  );
  return allocations;
}

/**
 * Compute weighted-average expected APR for an allocation set.
 */
export function weightedApr(allocations: AllocationEntry[]): number {
  return allocations.reduce((s, a) => s + a.pct * a.expectedApr, 0);
}
