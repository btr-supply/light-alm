import { describe, expect, test } from "bun:test";
import { aggregateCandles } from "../../shared/format";
import { CHAINS, chainGasCostUsd } from "../../shared/chains";
import { CANDLE_BUFFER_DAYS, MTF_CANDLES } from "../../src/config/params";
import type { Candle } from "../../shared/types";

// ---- Per-chain gas cost (Fix 3) ----

describe("chainGasCostUsd", () => {
  test("known chains return mapped values", () => {
    expect(chainGasCostUsd(1)).toBe(5.0); // Ethereum
    expect(chainGasCostUsd(42161)).toBe(0.10); // Arbitrum
    expect(chainGasCostUsd(56)).toBe(0.15); // BSC
    expect(chainGasCostUsd(43114)).toBe(0.15); // Avalanche
  });

  test("unknown chain returns default fallback", () => {
    expect(chainGasCostUsd(99999)).toBe(0.10);
    expect(chainGasCostUsd(0)).toBe(0.10);
    expect(chainGasCostUsd(-1)).toBe(0.10);
  });

  test("all map values are positive finite numbers", () => {
    for (const [, chain] of Object.entries(CHAINS)) {
      expect(chain.gasCostUsd).toBeGreaterThan(0);
      expect(Number.isFinite(chain.gasCostUsd)).toBe(true);
    }
  });

  test("map covers active chains", () => {
    expect(Object.keys(CHAINS).length).toBeGreaterThanOrEqual(7);
  });
});

// ---- Candle aggregation ----

describe("aggregateCandles", () => {
  test("empty input returns empty array", () => {
    expect(aggregateCandles([], 60_000)).toHaveLength(0);
  });

  test("single candle passes through", () => {
    const c: Candle = { ts: 60_000, o: 1.0, h: 1.1, l: 0.9, c: 1.05, v: 500 };
    const result = aggregateCandles([c], 60_000);
    expect(result).toHaveLength(1);
    expect(result[0].o).toBe(1.0);
    expect(result[0].h).toBe(1.1);
    expect(result[0].l).toBe(0.9);
    expect(result[0].c).toBe(1.05);
    expect(result[0].v).toBe(500);
  });

  test("multi-period OHLCV correctness", () => {
    // 6 M1 candles → 2 periods of 3 minutes each
    const candles: Candle[] = [
      { ts: 0, o: 1.0, h: 1.2, l: 0.9, c: 1.1, v: 100 },
      { ts: 60_000, o: 1.1, h: 1.3, l: 0.8, c: 1.05, v: 200 },
      { ts: 120_000, o: 1.05, h: 1.15, l: 0.95, c: 1.0, v: 150 },
      { ts: 180_000, o: 1.0, h: 1.1, l: 0.85, c: 0.9, v: 300 },
      { ts: 240_000, o: 0.9, h: 1.0, l: 0.7, c: 0.95, v: 250 },
      { ts: 300_000, o: 0.95, h: 1.05, l: 0.75, c: 0.8, v: 100 },
    ];
    const result = aggregateCandles(candles, 180_000); // 3-minute periods
    expect(result).toHaveLength(2);

    // First period [0, 60k, 120k]
    expect(result[0].ts).toBe(0);
    expect(result[0].o).toBe(1.0); // first candle's open
    expect(result[0].h).toBe(1.3); // max of 1.2, 1.3, 1.15
    expect(result[0].l).toBe(0.8); // min of 0.9, 0.8, 0.95
    expect(result[0].c).toBe(1.0); // last candle's close
    expect(result[0].v).toBe(450); // 100+200+150

    // Second period [180k, 240k, 300k]
    expect(result[1].ts).toBe(180_000);
    expect(result[1].o).toBe(1.0);
    expect(result[1].h).toBe(1.1);
    expect(result[1].l).toBe(0.7);
    expect(result[1].c).toBe(0.8);
    expect(result[1].v).toBe(650);
  });

  test("partial last period is preserved", () => {
    const candles: Candle[] = [
      { ts: 0, o: 1.0, h: 1.1, l: 0.9, c: 1.05, v: 100 },
      { ts: 60_000, o: 1.05, h: 1.2, l: 0.95, c: 1.1, v: 200 },
      { ts: 120_000, o: 1.1, h: 1.15, l: 1.0, c: 1.12, v: 150 },
      { ts: 180_000, o: 1.12, h: 1.25, l: 1.05, c: 1.2, v: 300 }, // starts new period
    ];
    const result = aggregateCandles(candles, 180_000);
    expect(result).toHaveLength(2);
    expect(result[1].o).toBe(1.12);
    expect(result[1].c).toBe(1.2);
  });
});

// ---- H1→H4 equivalence (Fix 9b critical correctness property) ----

describe("H1→H4 aggregation equivalence", () => {
  test("aggregating M1→H4 produces identical results to M1→H1→H4", () => {
    // Generate 480 M1 candles (8 hours = 2 full H4 periods)
    const m1: Candle[] = Array.from({ length: 480 }, (_, i) => {
      const p = 1.0 + 0.02 * Math.sin(i / 30); // smooth oscillation
      return {
        ts: i * 60_000,
        o: p - 0.001,
        h: p + 0.01 * (1 + (i % 7) / 10), // varying highs
        l: p - 0.01 * (1 + (i % 5) / 10), // varying lows
        c: p,
        v: 100 + (i % 13) * 10,
      };
    });

    // Direct path: M1 → H4
    const h4Direct = aggregateCandles(m1, 4 * 60 * 60_000);

    // Two-stage path: M1 → H1 → H4
    const h1 = aggregateCandles(m1, 60 * 60_000);
    const h4TwoStage = aggregateCandles(h1, 240 * 60_000);

    expect(h4Direct).toHaveLength(h4TwoStage.length);
    for (let i = 0; i < h4Direct.length; i++) {
      expect(h4TwoStage[i].ts).toBe(h4Direct[i].ts);
      expect(h4TwoStage[i].o).toBe(h4Direct[i].o);
      expect(h4TwoStage[i].h).toBe(h4Direct[i].h);
      expect(h4TwoStage[i].l).toBe(h4Direct[i].l);
      expect(h4TwoStage[i].c).toBe(h4Direct[i].c);
      expect(h4TwoStage[i].v).toBe(h4Direct[i].v);
    }
  });
});

// ---- CANDLE_BUFFER_DAYS sufficiency (Fix 9a) ----

describe("CANDLE_BUFFER_DAYS", () => {
  test("is sufficient for all MTF lookbacks", () => {
    // H4 is the binding constraint: MTF_CANDLES.h4 * 4 hours = days needed
    const daysNeeded = (MTF_CANDLES.h4 * 4) / 24;
    expect(CANDLE_BUFFER_DAYS).toBeGreaterThanOrEqual(daysNeeded);
  });
});
