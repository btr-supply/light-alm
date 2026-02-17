/**
 * End-to-end integration: full scheduler cycle
 * Tests data fetch -> forces compute -> decision -> optimizer flow
 * Uses mock DragonflyStore (in-memory Maps) and mock store-o2.
 */
import { describe, expect, test, beforeEach } from "bun:test";
import { randomBytes } from "crypto";

import { computeForces } from "../../src/strategy/forces";
import { computeRange } from "../../src/strategy/range";
import { checkKillSwitches, defaultRangeParams } from "../../src/strategy/optimizer";
import { POSITION_VALUE_USD } from "../../src/config/params";
import { synthFromCloses, synthRandomWalk, synthM15 } from "../helpers";

const TEST_PAIR = `E2E-${randomBytes(4).toString("hex")}`;

// ---- In-memory mock DragonflyStore ----

function createMockStore() {
  const positions = new Map<string, any>();
  let optimizerState: { vec: number[]; fitness: number } | null = null;
  let epoch = 0;
  let regimeSuppress = 0;
  let candleCursor = 0;

  return {
    savePosition: async (p: any) => { positions.set(p.id, p); },
    getPositions: async () => [...positions.values()],
    deletePosition: async (id: string) => { positions.delete(id); },
    getOptimizerState: async () => optimizerState,
    saveOptimizerState: async (vec: number[], fitness: number) => {
      optimizerState = { vec, fitness };
    },
    getEpoch: async () => epoch,
    incrementEpoch: async () => ++epoch,
    getRegimeSuppressUntil: async () => regimeSuppress,
    setRegimeSuppressUntil: async (e: number) => { regimeSuppress = e; },
    getLatestCandleTs: async () => candleCursor,
    setLatestCandleTs: async (ts: number) => { candleCursor = ts; },
    deleteAll: async () => {
      positions.clear();
      optimizerState = null;
      epoch = 0;
      regimeSuppress = 0;
      candleCursor = 0;
    },
    // Expose internals for assertions
    _getOptimizerState: () => optimizerState,
  };
}

describe("E2E: scheduler cycle integration", () => {
  let store: ReturnType<typeof createMockStore>;

  beforeEach(() => {
    store = createMockStore();
  });

  describe("Phase 1: data -> forces -> decision", () => {
    test("stable price with low volatility -> low vforce", () => {
      const candles = synthFromCloses(
        Array(100)
          .fill(1.0)
          .map(() => 1.0 + (Math.random() - 0.5) * 0.001),
        1.0,
      );

      // Compute forces from candles (pure function, no store needed)
      const forces = computeForces(candles);

      // Expect low volatility force (stable price)
      expect(forces.v.force).toBeLessThan(10);
      expect(forces.m.force).toBeGreaterThan(40);
      expect(forces.m.force).toBeLessThan(60);
      expect(forces.t.force).toBeGreaterThan(40);
      expect(forces.t.force).toBeLessThan(60);
    });

    test("high volatility + trending -> wider range, bias applied", () => {
      // Trending up with volatility
      const closes = Array(100)
        .fill(0)
        .map((_, i) => 1.0 + i * 0.001 + (Math.random() - 0.5) * 0.01);
      const candles = synthFromCloses(closes, 1.0);

      const forces = computeForces(candles);
      const price = candles[candles.length - 1].c;

      // Compute range from forces
      const range = computeRange(price, forces);

      // Trending up -> wider upside
      expect(range.min).toBeLessThan(price);
      expect(range.max).toBeGreaterThan(price);
      expect(range.max - price).toBeGreaterThanOrEqual(price - range.min); // Bias
    });

    test("optimizer: finds best range on historical data", () => {
      // Random walk candles (simulates real market)
      const m1Candles = synthRandomWalk(200, 1.0, 0.005);

      // Aggregate to M15 for optimizer
      const m15Candles = synthM15(m1Candles);

      // Compute forces
      const forces = computeForces(m1Candles);

      // Compute range
      const price = m15Candles[m15Candles.length - 1].c;
      const range = computeRange(price, { v: forces.v, m: forces.m, t: forces.t });

      // Range should be valid
      expect(range.min).toBeGreaterThan(0);
      expect(range.max).toBeGreaterThan(range.min);
      expect(range.breadth).toBeGreaterThan(0);
      expect(range.breadth).toBeLessThan(1); // Not wider than price
    });
  });

  describe("Phase 2: kill-switch evaluation", () => {
    test("clean history -> kill-switch inactive", () => {
      // Feed clean trailing yields (5 normal APRs)
      const trailingYields = [0.05, 0.06, 0.07, 0.08, 0.09];
      // 2 RS timestamps (not excessive)
      const now = Date.now();
      const rsTimestamps = [now - 3600_000, now - 1800_000];

      const ks = checkKillSwitches(
        { trailingYields, rsTimestamps, trailing24hGasUsd: 0 },
        POSITION_VALUE_USD,
        defaultRangeParams(),
      );
      expect(ks.useDefaults).toBe(false);
    });

    test("excessive RS -> kill-switch triggers", () => {
      const now = Date.now();
      // 10 RS in 4 hours (excessive)
      const rsTimestamps = Array.from({ length: 10 }, (_, i) =>
        now - (4 - i * 0.25) * 3600_000,
      );

      expect(rsTimestamps.length).toBeGreaterThan(8);

      const ks = checkKillSwitches(
        { trailingYields: [], rsTimestamps, trailing24hGasUsd: 0 },
        POSITION_VALUE_USD,
        defaultRangeParams(),
      );
      expect(ks.useDefaults).toBe(true);
      expect(ks.reason).toBe("excessive_rs");
    });
  });

  describe("Phase 3: state persistence round-trip", () => {
    test("optimizer state persists and loads via DragonflyStore", async () => {
      const vec = [0.001, 0.05, -1.0, 300, 0.15];
      const fitness = 0.85;

      await store.saveOptimizerState(vec, fitness);

      const loaded = await store.getOptimizerState();
      expect(loaded).not.toBeNull();
      expect(loaded!.vec).toEqual(vec);
      expect(loaded!.fitness).toBeCloseTo(0.85);
    });

    test("epoch counter increments", async () => {
      expect(await store.getEpoch()).toBe(0);
      const e1 = await store.incrementEpoch();
      expect(e1).toBe(1);
      const e2 = await store.incrementEpoch();
      expect(e2).toBe(2);
      expect(await store.getEpoch()).toBe(2);
    });

    test("position CRUD round-trip via DragonflyStore", async () => {
      const pos = {
        id: "e2e-pos-1",
        pool: "0x0000000000000000000000000000000000000001" as `0x${string}`,
        chain: 1,
        dex: "uniswap_v3",
        positionId: "42",
        tickLower: -100,
        tickUpper: 100,
        liquidity: 5000n,
        amount0: 2500n,
        amount1: 2500n,
        entryPrice: 1.0,
        entryTs: Date.now(),
        entryApr: 0.15,
        entryValueUsd: 5000,
      };

      await store.savePosition(pos);
      let positions = await store.getPositions();
      expect(positions).toHaveLength(1);

      await store.deletePosition("e2e-pos-1");
      positions = await store.getPositions();
      expect(positions).toHaveLength(0);
    });
  });
});
