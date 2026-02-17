import { describe, expect, test } from "bun:test";
import {
  computeRange,
  rangeDivergence,
  priceToTick,
  alignTick,
  rangeToTicks,
} from "../../src/strategy/range";
import { neutralForces } from "../helpers";

describe("computeRange", () => {
  test("neutral market produces symmetric range", () => {
    const r = computeRange(1.0, neutralForces(5));
    expect(r.type).toBe("neutral");
    expect(r.min).toBeLessThan(1.0);
    expect(r.max).toBeGreaterThan(1.0);
    // Symmetric: distance from base should be ~equal
    expect(Math.abs(1.0 - r.min - (r.max - 1.0))).toBeLessThan(0.001);
  });

  test("bullish trend biases range upward", () => {
    const r = computeRange(1.0, neutralForces(5, 70, 75));
    expect(r.type).toBe("bullish");
    expect(r.max - 1.0).toBeGreaterThan(1.0 - r.min);
  });

  test("bearish trend biases range downward", () => {
    const r = computeRange(1.0, neutralForces(5, 30, 25));
    expect(r.type).toBe("bearish");
    expect(1.0 - r.min).toBeGreaterThan(r.max - 1.0);
  });

  test("different volatility forces produce different ranges", () => {
    const lowVol = computeRange(100, neutralForces(2));
    const highVol = computeRange(100, neutralForces(50));
    // Both should produce valid positive breadth
    expect(lowVol.breadth).toBeGreaterThan(0);
    expect(highVol.breadth).toBeGreaterThan(0);
    // Range widths should differ
    expect(lowVol.breadth).not.toBe(highVol.breadth);
  });

  test("confidence degrades with high volatility", () => {
    const calm = computeRange(1.0, neutralForces(5));
    const volatile = computeRange(1.0, neutralForces(50));
    expect(volatile.confidence).toBeLessThan(calm.confidence);
  });
});

describe("rangeDivergence", () => {
  test("identical ranges = 0", () => {
    const r = {
      min: 0.99,
      max: 1.01,
      base: 1,
      breadth: 0.02,
      confidence: 100,
      trendBias: 0,
      type: "neutral" as const,
    };
    expect(rangeDivergence(r, r)).toBe(0);
  });

  test("completely offset = 1", () => {
    const a = {
      min: 0.9,
      max: 1.0,
      base: 0.95,
      breadth: 0.1,
      confidence: 100,
      trendBias: 0,
      type: "neutral" as const,
    };
    const b = {
      min: 1.1,
      max: 1.2,
      base: 1.15,
      breadth: 0.1,
      confidence: 100,
      trendBias: 0,
      type: "neutral" as const,
    };
    expect(rangeDivergence(a, b)).toBe(1);
  });

  test("partial overlap returns 0 < d < 1", () => {
    const a = {
      min: 0.95,
      max: 1.05,
      base: 1,
      breadth: 0.1,
      confidence: 100,
      trendBias: 0,
      type: "neutral" as const,
    };
    const b = {
      min: 0.98,
      max: 1.08,
      base: 1.03,
      breadth: 0.1,
      confidence: 100,
      trendBias: 0,
      type: "neutral" as const,
    };
    const d = rangeDivergence(a, b);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(1);
  });
});

describe("tick math", () => {
  test("priceToTick(1) = 0", () => expect(priceToTick(1)).toBe(0));
  test("priceToTick > 1 = positive tick", () => expect(priceToTick(1.01)).toBeGreaterThan(0));
  test("priceToTick < 1 = negative tick", () => expect(priceToTick(0.99)).toBeLessThan(0));

  test("alignTick rounds down", () => {
    expect(alignTick(107, 60, "down")).toBe(60);
    expect(alignTick(120, 60, "down")).toBe(120);
  });
  test("alignTick rounds up", () => {
    expect(alignTick(61, 60, "up")).toBe(120);
    expect(alignTick(120, 60, "up")).toBe(120);
  });

  test("rangeToTicks produces aligned ticks", () => {
    const range = {
      min: 0.999,
      max: 1.001,
      base: 1,
      breadth: 0.002,
      confidence: 100,
      trendBias: 0,
      type: "neutral" as const,
    };
    const { tickLower, tickUpper } = rangeToTicks(range, 10);
    expect(Math.abs(tickLower % 10)).toBe(0);
    expect(Math.abs(tickUpper % 10)).toBe(0);
    expect(tickLower).toBeLessThan(tickUpper);
  });
});
