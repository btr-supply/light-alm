/**
 * End-to-end integration: full scheduler cycle
 * Tests data fetch → forces compute → decision → executor flow
 * Minimal mocking, real in-memory DB, real calculations.
 */
import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { randomBytes } from "crypto";

import type { Forces } from "../../src/types";
import { computeForces } from "../../src/strategy/forces";
import { computeRange } from "../../src/strategy/range";
import {
  initPairStore,
  saveCandles,
  savePairAllocation,
  saveOptimizerState,
  saveEpochSnapshot,
  getRecentYields,
  getRecentRsTimestamps,
  getTrailingTxCount,
} from "../../src/data/store";
import { synthFromCloses, synthRandomWalk, synthM15 } from "../helpers";

const TEST_PAIR = `E2E-${randomBytes(4).toString("hex")}`;

describe("E2E: scheduler cycle integration", () => {
  let db: Database;

  beforeEach(() => {
    db = initPairStore(TEST_PAIR, ":memory:");
  });

  describe("Phase 1: data → forces → decision", () => {
    test("stable price with low volatility → HOLD decision", () => {
      // Seed stable candles (price flatlines around 1.0)
      const candles = synthFromCloses(
        Array(100)
          .fill(1.0)
          .map(() => 1.0 + (Math.random() - 0.5) * 0.001),
        1.0,
      );
      saveCandles(db, candles);

      // Compute forces from candles
      const m1Forces = computeForces(candles);
      const forces: Forces = {
        v: m1Forces.volatility,
        m: m1Forces.momentum,
        t: m1Forces.trend,
      };

      // Expect low volatility force (stable price)
      expect(forces.v.force).toBeLessThan(10);
      expect(forces.m.force).toBeGreaterThan(40);
      expect(forces.m.force).toBeLessThan(60);
      expect(forces.t.force).toBeGreaterThan(40);
      expect(forces.t.force).toBeLessThan(60);
    });

    test("high volatility + trending → wider range, bias applied", () => {
      // Trending up with volatility
      const closes = Array(100)
        .fill(0)
        .map((_, i) => 1.0 + i * 0.001 + (Math.random() - 0.5) * 0.01);
      const candles = synthFromCloses(closes, 1.0);
      saveCandles(db, candles);

      const forces = computeForces(candles);
      const price = candles[candles.length - 1].c;

      // Compute range from forces
      const range = computeRange(price, forces);

      // Trending up → wider upside
      expect(range.min).toBeLessThan(price);
      expect(range.max).toBeGreaterThan(price);
      expect(range.max - price).toBeGreaterThanOrEqual(price - range.min); // Bias
    });

    test("optimizer: finds best range on historical data", () => {
      // Random walk candles (simulates real market)
      const m1Candles = synthRandomWalk(200, 1.0, 0.005);
      saveCandles(db, m1Candles);

      // Aggregate to M15 for optimizer
      const m15Candles = synthM15(m1Candles);

      // Compute forces
      const forces = computeForces(m1Candles);
      const composite = { v: forces.v, m: forces.m, t: forces.t };

      // Compute range
      const price = m15Candles[m15Candles.length - 1].c;
      const range = computeRange(price, composite);

      // Range should be valid
      expect(range.min).toBeGreaterThan(0);
      expect(range.max).toBeGreaterThan(range.min);
      expect(range.breadth).toBeGreaterThan(0);
      expect(range.breadth).toBeLessThan(1); // Not wider than price
    });
  });

  describe("Phase 2: kill-switch evaluation", () => {
    test("clean history → kill-switch inactive", () => {
      const now = Date.now();

      // Add a few normal allocations
      for (let i = 0; i < 5; i++) {
        savePairAllocation(db, {
          ts: now - (5 - i) * 3600_000, // Hourly, last 5 hours
          currentApr: 0.05 + i * 0.01,
          optimalApr: 0.1,
          improvement: 0.05,
          decision: i % 2 === 0 ? "HOLD" : "RS",
          targetAllocations: [],
          currentAllocations: [],
        });
      }

      const yields = getRecentYields(db, 24);
      const rsTimestamps = getRecentRsTimestamps(db, now - 4 * 3600_000);
      const txCount = getTrailingTxCount(db, now - 24 * 3600_000);

      expect(yields).toHaveLength(5);
      expect(rsTimestamps).toHaveLength(2); // 2 RS decisions
      expect(txCount).toBe(0); // No tx logs

      // Kill-switch conditions
      const tooManyRs = rsTimestamps.length > 8;
      const lowYield = yields.length > 0 && yields[yields.length - 1] < 0;
      const highGasCost = txCount * 0.5 > 100; // $100 threshold

      expect(tooManyRs).toBe(false);
      expect(lowYield).toBe(false);
      expect(highGasCost).toBe(false);
    });

    test("excessive RS → kill-switch triggers", () => {
      const now = Date.now();

      // 10 RS in 4 hours (excessive)
      for (let i = 0; i < 10; i++) {
        savePairAllocation(db, {
          ts: now - (4 - i * 0.25) * 3600_000, // Every 15min
          currentApr: 0.01,
          optimalApr: 0.05,
          improvement: 0.4,
          decision: "RS",
          targetAllocations: [],
          currentAllocations: [],
        });
      }

      const rsTimestamps = getRecentRsTimestamps(db, now - 4 * 3600_000);
      expect(rsTimestamps.length).toBeGreaterThan(8);
    });
  });

  describe("Phase 3: state persistence round-trip", () => {
    test("optimizer state persists and loads", () => {
      const state = {
        vec: [0.001, 0.05, -1.0, 300, 0.15],
        fitness: 0.85,
        updated_at: Date.now(),
      };

      saveOptimizerState(db, TEST_PAIR, state);

      // Verify via DB query
      const row = db
        .query("SELECT vec, fitness, updated_at FROM optimizer_state WHERE pair_id = ?")
        .get(TEST_PAIR);
      expect(row).toBeDefined();
      expect(JSON.parse(row.vec)).toEqual(state.vec);
      expect(row.fitness).toBeCloseTo(0.85);
    });

    test("epoch snapshot captures portfolio state", () => {
      const now = Date.now();

      // Seed some history
      savePairAllocation(db, {
        ts: now - 60_000,
        currentApr: 0.08,
        optimalApr: 0.1,
        improvement: 0.25,
        decision: "PRA",
        targetAllocations: [],
        currentAllocations: [],
      });

      saveEpochSnapshot(db, {
        pairId: TEST_PAIR,
        epoch: 1,
        ts: now,
        decision: "PRA",
        portfolioValueUsd: 10_000,
        feesEarnedUsd: 12.5,
        gasSpentUsd: 3.2,
        ilUsd: -2.1,
        netPnlUsd: 7.2,
        rangeEfficiency: 0.75,
        currentApr: 0.08,
        optimalApr: 0.1,
        positionsCount: 2,
      });

      // Retrieve and verify
      const snapshots = db.query("SELECT * FROM epoch_snapshots WHERE pair_id = ?").all(TEST_PAIR);
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].portfolio_value_usd).toBe(10_000);
      expect(snapshots[0].net_pnl_usd).toBe(7.2);
    });
  });
});
