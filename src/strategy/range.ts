import type { Forces, ForceParams, Range } from "../types";
import { DEFAULT_FORCE_PARAMS } from "../config/params";
import { cap } from "../utils";

/**
 * Convert volatility force to base range width (as fraction of price).
 * Port of front-end volatilityToBaseRange.
 */
export function baseRangeWidth(
  vforce: number,
  min: number,
  max: number,
  vforceExp: number,
  vforceDivider: number,
): number {
  return min + (max - min) * Math.exp((vforceExp * vforce) / vforceDivider);
}

/**
 * Compute optimal range from forces.
 * Port of front-end findBtrRange, simplified for agentic use.
 */
export function computeRange(
  price: number,
  forces: Forces,
  params: ForceParams = DEFAULT_FORCE_PARAMS,
): Range {
  const { v, m, t } = forces;
  let confidence = 100;
  let trendBias = 0;
  let type: Range["type"] = "neutral";

  // Confidence decay from volatility above critical threshold
  confidence *= Math.exp(params.confidence.vforceExp * (v.force - params.volatility.criticalForce));

  // Trend bias scaled by confidence
  trendBias = ((t.force - 50) / 50) * (confidence / 100);

  if (t.force > params.trend.bearishFrom && t.force < params.trend.bullishFrom) {
    // Ranging market
    type = "neutral";
    if (m.force > params.momentum.overboughtFrom || m.force < params.momentum.oversoldFrom) {
      // Pre-breakout: reduce confidence
      // Guard against division by zero when m.force === 50
      const divergence = Math.abs(m.force - 50) || 1;
      confidence /= divergence * params.confidence.mforceDivider;
    }
  } else {
    // Trending market
    type = t.force >= params.trend.bullishFrom ? "bullish" : "bearish";
    trendBias = (t.force - 50) / 100; // [-.5, .5]

    if ((m.force > 50 && t.force > 50) || (m.force < 50 && t.force < 50)) {
      // Momentum backs the trend
      trendBias *= Math.exp(params.trend.biasExp * Math.abs(m.force - 50));
    } else {
      // Momentum opposes trend
      // Guard against division by zero when m.force === 50
      const divergence = Math.abs(m.force - 50) || 1;
      trendBias /= divergence * params.trend.biasDivider;
      confidence /= divergence * params.confidence.mforceDivider;
    }
  }

  confidence = cap(confidence, 0, 100);

  // Base range from volatility
  const baseWidth =
    price *
    baseRangeWidth(
      v.force,
      params.baseRange.min,
      params.baseRange.max,
      params.baseRange.vforceExp,
      params.baseRange.vforceDivider,
    );
  const absBias = 1 + Math.abs(trendBias);
  let rMin = baseWidth,
    rMax = baseWidth;

  if (trendBias > 0) {
    rMin = baseWidth / absBias;
    rMax = baseWidth * absBias;
  } else if (trendBias < 0) {
    rMin = baseWidth * absBias;
    rMax = baseWidth / absBias;
  }

  const min = price - rMin;
  const max = price + rMax;
  const breadth = (max - min) / price;

  return { min, max, base: price, breadth, confidence, trendBias, type };
}

/**
 * Raw divergence between two intervals: combined size + center offset, clamped to [0, 1].
 */
export function rawDivergence(aMin: number, aMax: number, bMin: number, bMax: number): number {
  const aRange = aMax - aMin;
  const bRange = bMax - bMin;
  if (aRange === 0 && bRange === 0) return 0;
  if (aRange === 0) return 1;

  const sizeDiff = Math.abs(bRange - aRange) / aRange;
  const centerDiff = Math.abs((aMin + aMax) / 2 - (bMin + bMax) / 2) / aRange;

  return Math.min(sizeDiff + centerDiff, 1);
}

/**
 * Divergence between two ranges: combined size + center offset.
 */
export function rangeDivergence(current: Range, target: Range): number {
  return rawDivergence(current.min, current.max, target.min, target.max);
}

// Import and re-export shared tick math — single source of truth for the 1.0001 tick base constant
import { priceToTick } from "../../shared/format";
export { priceToTick } from "../../shared/format";

/**
 * Align tick to nearest valid tick spacing.
 */
export function alignTick(tick: number, spacing: number, round: "down" | "up"): number {
  if (round === "down") return Math.floor(tick / spacing) * spacing;
  return Math.ceil(tick / spacing) * spacing;
}

/**
 * Convert range prices to aligned tick range.
 */
export function rangeToTicks(
  range: Range,
  tickSpacing: number,
): { tickLower: number; tickUpper: number } {
  const rawLower = priceToTick(range.min);
  const rawUpper = priceToTick(range.max);
  return {
    tickLower: alignTick(rawLower, tickSpacing, "down"),
    tickUpper: alignTick(rawUpper, tickSpacing, "up"),
  };
}
