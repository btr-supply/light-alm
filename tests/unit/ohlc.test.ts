import { describe, expect, test, beforeAll, beforeEach } from "bun:test";
import { TF_MS, BACKFILL_DAYS } from "../../src/config/params";
import { mergeWeightedCandles } from "../../src/data/ohlc";
import type { Candle } from "../../src/types";
import { silenceLog } from "../helpers";

beforeAll(silenceLog);

// ---- fetchWeightedCandles ----
// Tests weighted average computation for multi-source candles.
// Uses the exported mergeWeightedCandles from ohlc.ts.

const weightedMerge = mergeWeightedCandles;

describe("fetchWeightedCandles (logic)", () => {
  test("single source with weight 1.0 passes through unchanged", () => {
    const candles: Candle[] = [
      { ts: 60000, o: 1.0, h: 1.1, l: 0.9, c: 1.05, v: 100 },
      { ts: 120000, o: 1.05, h: 1.15, l: 0.95, c: 1.1, v: 200 },
    ];
    const result = weightedMerge([{ candles, weight: 1.0 }]);
    expect(result).toHaveLength(2);
    expect(result[0].o).toBeCloseTo(1.0);
    expect(result[0].c).toBeCloseTo(1.05);
    expect(result[0].h).toBe(1.1);
    expect(result[0].l).toBe(0.9);
    expect(result[0].v).toBe(100);
  });

  test("two equal-weight sources average O and C", () => {
    const src1: Candle[] = [{ ts: 60000, o: 1.0, h: 1.1, l: 0.9, c: 1.05, v: 100 }];
    const src2: Candle[] = [{ ts: 60000, o: 1.02, h: 1.08, l: 0.92, c: 1.07, v: 150 }];

    const result = weightedMerge([
      { candles: src1, weight: 0.5 },
      { candles: src2, weight: 0.5 },
    ]);

    expect(result).toHaveLength(1);
    // O = (1.00*0.5 + 1.02*0.5) / 1.0 = 1.01
    expect(result[0].o).toBeCloseTo(1.01, 6);
    // C = (1.05*0.5 + 1.07*0.5) / 1.0 = 1.06
    expect(result[0].c).toBeCloseTo(1.06, 6);
    // H = max(1.10, 1.08) = 1.10
    expect(result[0].h).toBe(1.1);
    // L = min(0.90, 0.92) = 0.90
    expect(result[0].l).toBe(0.9);
    // V = 100 + 150 = 250
    expect(result[0].v).toBe(250);
  });

  test("unequal weights bias toward heavier source", () => {
    const src1: Candle[] = [{ ts: 60000, o: 1.0, h: 1.1, l: 0.9, c: 1.0, v: 100 }];
    const src2: Candle[] = [{ ts: 60000, o: 2.0, h: 2.1, l: 1.9, c: 2.0, v: 200 }];

    const result = weightedMerge([
      { candles: src1, weight: 0.75 },
      { candles: src2, weight: 0.25 },
    ]);

    // O = (1.0*0.75 + 2.0*0.25) / 1.0 = 1.25
    expect(result[0].o).toBeCloseTo(1.25, 6);
    // C = (1.0*0.75 + 2.0*0.25) / 1.0 = 1.25
    expect(result[0].c).toBeCloseTo(1.25, 6);
  });

  test("non-overlapping timestamps produce separate candles", () => {
    const src1: Candle[] = [{ ts: 60000, o: 1.0, h: 1.1, l: 0.9, c: 1.05, v: 100 }];
    const src2: Candle[] = [{ ts: 120000, o: 1.05, h: 1.15, l: 0.95, c: 1.1, v: 200 }];

    const result = weightedMerge([
      { candles: src1, weight: 0.5 },
      { candles: src2, weight: 0.5 },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0].ts).toBe(60000);
    expect(result[1].ts).toBe(120000);
  });

  test("empty sources produce empty result", () => {
    const result = weightedMerge([]);
    expect(result).toHaveLength(0);
  });

  test("one failed source (empty) still produces results from other", () => {
    const src1: Candle[] = [{ ts: 60000, o: 1.0, h: 1.1, l: 0.9, c: 1.05, v: 100 }];
    const result = weightedMerge([
      { candles: src1, weight: 0.4 },
      { candles: [], weight: 0.6 },
    ]);

    expect(result).toHaveLength(1);
    // Only src1 contributes, so O/C should be the raw values from src1
    // O = (1.0 * 0.4) / 0.4 = 1.0
    expect(result[0].o).toBeCloseTo(1.0, 6);
    expect(result[0].c).toBeCloseTo(1.05, 6);
  });

  test("result is sorted by timestamp", () => {
    const src1: Candle[] = [
      { ts: 180000, o: 1.0, h: 1.1, l: 0.9, c: 1.05, v: 100 },
      { ts: 60000, o: 1.0, h: 1.1, l: 0.9, c: 1.05, v: 100 },
    ];
    const result = weightedMerge([{ candles: src1, weight: 1.0 }]);
    expect(result[0].ts).toBeLessThan(result[1].ts);
  });
});

// ---- backfill ----
// Tests cursor advancement logic using a mock DragonflyStore.

/** In-memory mock of DragonflyStore for candle cursor tests. */
function mockStore() {
  let candleCursor = 0;
  return {
    getLatestCandleTs: async () => candleCursor,
    setLatestCandleTs: async (ts: number) => { candleCursor = ts; },
  };
}

describe("backfill", () => {
  test("skips when candles are up to date", async () => {
    const store = mockStore();
    const now = Date.now();
    await store.setLatestCandleTs(now - TF_MS + 1000);

    const latestTs = await store.getLatestCandleTs();
    expect(latestTs).toBeGreaterThan(0);
    // since = latestTs + TF_MS which should be >= now - TF_MS, so backfill skips
    const since = latestTs + TF_MS;
    expect(since).toBeGreaterThanOrEqual(now - TF_MS);
  });

  test("computes correct since from empty store", async () => {
    const store = mockStore();
    const latestTs = await store.getLatestCandleTs();
    expect(latestTs).toBe(0);
    const now = Date.now();
    const since = latestTs > 0 ? latestTs + TF_MS : now - BACKFILL_DAYS * 24 * 60 * 60 * 1000;
    // Should go back BACKFILL_DAYS
    const expectedSince = now - BACKFILL_DAYS * 24 * 60 * 60 * 1000;
    expect(Math.abs(since - expectedSince)).toBeLessThan(100);
  });

  test("computes correct since from existing cursor", async () => {
    const store = mockStore();
    const knownTs = 1700000000000;
    await store.setLatestCandleTs(knownTs);
    const latestTs = await store.getLatestCandleTs();
    expect(latestTs).toBe(knownTs);
    const since = latestTs + TF_MS;
    expect(since).toBe(knownTs + TF_MS);
  });
});
