import type { Decision, PairAllocation, AllocationEntry, Position, Range, Forces } from "../types";
import { weightedApr } from "./allocation";
import { computeRange, rangeDivergence } from "./range";
import { tickToPrice } from "../../shared/format";
import {
  MIN_HOLD_MS,
  HOUR_MS,
  MIN_ABSOLUTE_APR_GAIN,
  PRA_GAS_MULT,
  RS_GAS_MULT,
  AMORTIZE_DAYS,
} from "../config/params";
import { fmtPct as pct } from "../../shared/format";
import { log } from "../utils";

interface DecideOpts {
  gasCostUsd: number;
  positionValueUsd: number;
}

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
  opts?: DecideOpts,
): Decision {
  const now = Date.now();
  const optimalApr = weightedApr(targetAllocations);
  const gasCostUsd = opts?.gasCostUsd ?? 0;
  const positionValueUsd = opts?.positionValueUsd ?? 0;

  // Value-weighted current APR (weighted by entryValueUsd, fallback to equal weight)
  const currentApr = (() => {
    if (positions.length === 0) return 0;
    const totalValue = positions.reduce((s, p) => s + p.entryValueUsd, 0);
    if (totalValue > 0) {
      return positions.reduce((s, p) => s + p.entryApr * (p.entryValueUsd / totalValue), 0);
    }
    return positions.reduce((s, p) => s + p.entryApr, 0) / positions.length;
  })();

  // Improvement: relative gain with absolute floor to prevent noise triggers
  const aprGain = optimalApr - currentApr;
  const improvement =
    currentApr > 0 ? aprGain / currentApr : aprGain > MIN_ABSOLUTE_APR_GAIN ? 1 : 0;

  const base = { ts: now, currentApr, optimalApr, improvement, targetAllocations };

  // Minimum holding period: force HOLD if last rebalance was too recent
  if (lastRebalTs !== undefined && now - lastRebalTs < MIN_HOLD_MS) {
    log.debug(
      `HOLD (min hold) — ${((now - lastRebalTs) / HOUR_MS).toFixed(1)}h since last rebal, need ${(MIN_HOLD_MS / HOUR_MS).toFixed(0)}h`,
    );
    return { type: "HOLD", ...base };
  }

  // PRA check: is the new allocation meaningfully better?
  if (improvement > thresholds.pra) {
    // Gas-cost gate: expected gain over amortization period must exceed gas cost
    if (gasCostUsd > 0 && positionValueUsd > 0) {
      const expectedGainUsd = aprGain * positionValueUsd * (AMORTIZE_DAYS / 365);
      if (expectedGainUsd < gasCostUsd * PRA_GAS_MULT) {
        log.debug(
          `HOLD (gas gate) — PRA gain $${expectedGainUsd.toFixed(2)} < ${PRA_GAS_MULT}x gas $${gasCostUsd.toFixed(2)}`,
        );
        return { type: "HOLD", ...base };
      }
    }
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
      // LB positions store bin IDs (not V3 ticks) — skip tick-based divergence check
      if (pos.positionId.startsWith("lb:")) continue;
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
        // Gas-cost gate: estimated fee loss from stale range must justify gas
        if (gasCostUsd > 0 && pos.entryValueUsd > 0) {
          const estimatedLossUsd = pos.entryValueUsd * div * pos.entryApr * (AMORTIZE_DAYS / 365);
          if (estimatedLossUsd < gasCostUsd * RS_GAS_MULT) {
            log.debug(
              `HOLD (gas gate) — RS loss $${estimatedLossUsd.toFixed(2)} < ${RS_GAS_MULT}x gas $${gasCostUsd.toFixed(2)} for ${pos.pool}`,
            );
            continue;
          }
        }
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
