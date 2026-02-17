import type { Decision, PairAllocation, AllocationEntry, Position, Range, Forces } from "../types";
import { weightedApr } from "./allocation";
import { computeRange, rangeDivergence } from "./range";
import { tickToPrice } from "../../shared/format";
import { MIN_HOLD_MS } from "../config/params";
import { log, pct } from "../utils";

/**
 * Pure decision function: evaluates PRA, RS, or HOLD.
 *
 * No data fetching — all inputs provided as arguments.
 */
export function decide(
  targetAllocations: AllocationEntry[],
  positions: Position[],
  forces: Forces,
  price: number,
  thresholds: { pra: number; rs: number },
  lastRebalTs?: number,
): Decision {
  const now = Date.now();
  const optimalApr = weightedApr(targetAllocations);

  // Value-weighted current APR (weighted by entryValueUsd, fallback to equal weight)
  const currentApr = (() => {
    if (positions.length === 0) return 0;
    const totalValue = positions.reduce((s, p) => s + p.entryValueUsd, 0);
    if (totalValue > 0) {
      return positions.reduce((s, p) => s + p.entryApr * (p.entryValueUsd / totalValue), 0);
    }
    return positions.reduce((s, p) => s + p.entryApr, 0) / positions.length;
  })();

  // Improvement calculation
  const improvement =
    currentApr > 0 ? (optimalApr - currentApr) / currentApr : optimalApr > 0 ? 1 : 0;

  const base = { ts: now, currentApr, optimalApr, improvement, targetAllocations };

  // Minimum holding period: force HOLD if last rebalance was too recent
  if (lastRebalTs !== undefined && now - lastRebalTs < MIN_HOLD_MS) {
    log.debug(
      `HOLD (min hold) — ${((now - lastRebalTs) / 3600_000).toFixed(1)}h since last rebal, need ${(MIN_HOLD_MS / 3600_000).toFixed(0)}h`,
    );
    return { type: "HOLD", ...base };
  }

  // PRA check: is the new allocation meaningfully better?
  if (improvement > thresholds.pra) {
    log.info(
      `PRA triggered — current=${pct(currentApr)} optimal=${pct(optimalApr)} improvement=${pct(improvement)}`,
    );
    return { type: "PRA", ...base };
  }

  // RS check: range divergence
  if (positions.length > 0) {
    const targetRange = computeRange(price, forces);
    const shifts: Decision["rangeShifts"] = [];

    for (const pos of positions) {
      const pMin = tickToPrice(pos.tickLower);
      const pMax = tickToPrice(pos.tickUpper);
      const currentRange: Range = {
        min: pMin,
        max: pMax,
        base: price,
        breadth: (pMax - pMin) / price,
        confidence: 0,
        trendBias: 0,
        type: "neutral",
      };

      const div = rangeDivergence(currentRange, targetRange);
      if (div > thresholds.rs) {
        shifts.push({
          pool: pos.pool,
          chain: pos.chain,
          oldRange: currentRange,
          newRange: targetRange,
        });
      }
    }

    if (shifts.length > 0) {
      log.info(`RS triggered — ${shifts.length} position(s) need range shift`);
      return { type: "RS", ...base, rangeShifts: shifts };
    }
  }

  // HOLD
  log.debug(
    `HOLD — current=${pct(currentApr)} optimal=${pct(optimalApr)} improvement=${pct(improvement)}`,
  );
  return { type: "HOLD", ...base };
}

/**
 * Build PairAllocation from decision result for persistence.
 */
export function buildPairAllocation(
  decision: Decision,
  currentPositions: Position[],
): PairAllocation {
  const currentAllocations: AllocationEntry[] = currentPositions.map((p) => ({
    pool: p.pool,
    chain: p.chain,
    dex: p.dex,
    pct: 1 / (currentPositions.length || 1),
    expectedApr: p.entryApr,
  }));

  return {
    ts: decision.ts,
    currentApr: decision.currentApr,
    optimalApr: decision.optimalApr,
    improvement: decision.improvement,
    decision: decision.type,
    targetAllocations: decision.targetAllocations,
    currentAllocations,
  };
}
