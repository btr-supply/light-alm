import type { AllocationEntry, PoolAnalysis, PoolConfig, DexId } from "../types";
import {
  POSITION_VALUE_USD,
  BISECT_MAX_ITERS,
  BISECT_LO,
  BISECT_CONVERGENCE_TOL,
  ALLOC_MIN_PCT,
} from "../config/params";
import { log, pct } from "../utils";

/**
 * Water-filling allocation optimizer.
 *
 * Models each pool's marginal APR as a decreasing function of allocated capital:
 *   marginal_apr(pool, x) = pool.apr * pool.tvl / (pool.tvl + x * totalCapitalUsd)
 *
 * This is a concave optimization: at equilibrium, marginal APRs across all
 * selected pools should be equal (like water filling containers of different widths).
 *
 * For N pools sorted by APR, we iteratively find the water level (lambda)
 * where the sum of allocations equals 1.
 */
export function waterFill(
  analyses: PoolAnalysis[],
  pools: PoolConfig[],
  maxPositions: number,
  totalCapitalUsd = POSITION_VALUE_USD,
): AllocationEntry[] {
  // Take top N pools by APR
  const top = analyses.slice(0, maxPositions).filter((a) => a.apr > 0);
  if (!top.length) return [];

  const poolMap = new Map(pools.map((p) => [`${p.chain}:${p.address}`, p]));
  const poolLookup = (a: PoolAnalysis) => poolMap.get(`${a.chain}:${a.pool}`);

  if (top.length === 1) {
    const p = poolLookup(top[0]);
    return [
      {
        pool: top[0].pool,
        chain: top[0].chain,
        dex: p?.dex ?? ("" as DexId),
        pct: 1,
        expectedApr: top[0].apr,
      },
    ];
  }

  // Binary search on lambda for equilibrium marginal APR
  // Dilution model: apr_i(d_i) = apr_i * tvl_i / (tvl_i + xi * totalCapitalUsd)
  // At equilibrium: xi = (apr_i / lambda - 1) * tvl_i / totalCapitalUsd

  let lo = BISECT_LO;
  let hi = top[0].apr;

  for (let iter = 0; iter < BISECT_MAX_ITERS; iter++) {
    const lambda = (lo + hi) / 2;
    let sumPct = 0;
    for (const a of top) {
      const xi = ((a.apr / lambda - 1) * a.tvl) / totalCapitalUsd;
      sumPct += Math.max(xi, 0);
    }
    if (sumPct > 1) lo = lambda;
    else hi = lambda;
    if (Math.abs(sumPct - 1) < BISECT_CONVERGENCE_TOL) break;
  }

  const lambda = (lo + hi) / 2;
  const allocations: AllocationEntry[] = [];

  for (const a of top) {
    const xi = Math.max(((a.apr / lambda - 1) * a.tvl) / totalCapitalUsd, 0);
    if (xi > ALLOC_MIN_PCT) {
      const expectedApr = (a.apr * a.tvl) / (a.tvl + xi * totalCapitalUsd);
      const p = poolLookup(a);
      allocations.push({
        pool: a.pool,
        chain: a.chain,
        dex: p?.dex ?? ("" as DexId),
        pct: xi,
        expectedApr,
      });
    }
  }

  // Normalize to sum=1
  const total = allocations.reduce((s, a) => s + a.pct, 0);
  if (total > 0) {
    for (const a of allocations) a.pct /= total;
  }

  log.debug(
    `Water-fill: ${allocations.map((a) => `${a.pool.slice(0, 10)}=${pct(a.pct)} @${pct(a.expectedApr)}`).join(", ")}`,
  );
  return allocations;
}

/**
 * Compute weighted-average expected APR for an allocation set.
 */
export function weightedApr(allocations: AllocationEntry[]): number {
  return allocations.reduce((s, a) => s + a.pct * a.expectedApr, 0);
}
