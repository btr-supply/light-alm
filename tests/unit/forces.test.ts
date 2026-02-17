import { describe, expect, test } from "bun:test";
import { vforce, mforce, tforce, computeForces, compositeForces } from "../../src/strategy/forces";
import type { Candle } from "../../src/types";
import { synthFromCloses, synthHL } from "../helpers";

describe("vforce", () => {
  test("stable prices = low force", () => {
    const candles = synthHL(5, 0.0002, 1.0);
    const r = vforce(candles, 5);
    expect(r.force).toBeLessThan(2);
    expect(r.std).toBe(0);
  });
  test("volatile prices = higher force", () => {
    const closes = [1.0, 1.1, 0.9, 1.2, 0.8];
    const candles: Candle[] = closes.map((c, i) => ({
      ts: i * 60_000,
      o: c,
      h: c * 1.05,
      l: c * 0.95,
      c,
      v: 1000,
    }));
    const r = vforce(candles, 5);
    expect(r.force).toBeGreaterThan(5);
  });
  test("capped at 100", () => {
    const closes = [1, 100, 1, 100, 1];
    const candles: Candle[] = closes.map((c, i) => ({
      ts: i * 60_000,
      o: c,
      h: c * 1.5,
      l: c * 0.5,
      c,
      v: 1000,
    }));
    const r = vforce(candles, 5);
    expect(r.force).toBeLessThanOrEqual(100);
  });
  test("insufficient data", () => {
    expect(vforce(synthFromCloses([1]), 5).force).toBe(0);
  });
});

describe("mforce", () => {
  test("uptrend = high force", () => {
    const r = mforce([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], 14);
    expect(r.force).toBeGreaterThan(70);
    expect(r.up).toBeGreaterThan(r.down);
  });
  test("downtrend = low force", () => {
    const r = mforce([16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1], 14);
    expect(r.force).toBeLessThan(30);
    expect(r.down).toBeGreaterThan(r.up);
  });
  test("insufficient data = neutral", () => {
    expect(mforce([1], 5).force).toBe(50);
  });
});

describe("tforce", () => {
  test("uptrend = force > 50", () => {
    const prices = Array.from({ length: 40 }, (_, i) => 100 + i);
    const r = tforce(prices, 36);
    expect(r.force).toBeGreaterThan(50);
    expect(r.ma0).toBeGreaterThan(r.ma1);
  });
  test("downtrend = force < 50", () => {
    const prices = Array.from({ length: 40 }, (_, i) => 140 - i);
    const r = tforce(prices, 36);
    expect(r.force).toBeLessThan(50);
    expect(r.ma0).toBeLessThan(r.ma1);
  });
  test("flat = force ~ 50", () => {
    const r = tforce(Array(40).fill(100), 36);
    expect(r.force).toBe(50);
  });
  test("insufficient data", () => {
    const r = tforce([1, 2], 36);
    expect(r.force).toBe(50);
  });
});

describe("computeForces", () => {
  test("returns all three forces in valid range", () => {
    const candles = synthFromCloses(Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i / 5)));
    const f = computeForces(candles);
    expect(f.v.force).toBeGreaterThanOrEqual(0);
    expect(f.v.force).toBeLessThanOrEqual(100);
    expect(f.m.force).toBeGreaterThanOrEqual(0);
    expect(f.m.force).toBeLessThanOrEqual(100);
    expect(f.t.force).toBeGreaterThanOrEqual(0);
    expect(f.t.force).toBeLessThanOrEqual(100);
  });
});

describe("compositeForces", () => {
  test("produces blended forces from M1 candles (3-frame MTF: M15, H1, H4)", () => {
    // 1500 M1 candles = 25 hours (covers M15, H1, H4)
    // Steady uptrend: momentum and trend should be above neutral (50)
    const candles = synthFromCloses(Array.from({ length: 1500 }, (_, i) => 100 + i * 0.01));
    const f = compositeForces(candles);
    expect(f.v.force).toBeGreaterThanOrEqual(0);
    expect(f.v.force).toBeLessThanOrEqual(100);
    expect(f.m.force).toBeGreaterThan(50); // uptrend → above-neutral momentum
    expect(f.t.force).toBeGreaterThan(50); // uptrend → above-neutral trend
  });
});
