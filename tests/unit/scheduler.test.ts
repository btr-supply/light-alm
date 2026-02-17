import { describe, expect, test, beforeEach, beforeAll } from "bun:test";
import { Database } from "bun:sqlite";
import { DEFAULT_FORCE_PARAMS } from "../../src/config/params";
import type { TxLogEntry } from "../../src/types";
import { mergeForceParams } from "../../src/scheduler";
import { silenceLog } from "../helpers";

// Silence log output during tests
beforeAll(silenceLog);

describe("mergeForceParams", () => {
  test("returns defaults when no partial provided", () => {
    const result = mergeForceParams();
    expect(result.volatility.lookback).toBe(DEFAULT_FORCE_PARAMS.volatility.lookback);
    expect(result.momentum.lookback).toBe(DEFAULT_FORCE_PARAMS.momentum.lookback);
    expect(result.trend.lookback).toBe(DEFAULT_FORCE_PARAMS.trend.lookback);
    expect(result.rsThreshold).toBe(DEFAULT_FORCE_PARAMS.rsThreshold);
    expect(result.baseRange.min).toBe(DEFAULT_FORCE_PARAMS.baseRange.min);
  });

  test("returns defaults when undefined provided", () => {
    const result = mergeForceParams(undefined);
    expect(result).toEqual({ ...DEFAULT_FORCE_PARAMS });
  });

  test("overrides only specified volatility fields", () => {
    const result = mergeForceParams({ volatility: { lookback: 48, criticalForce: 20 } });
    expect(result.volatility.lookback).toBe(48);
    expect(result.volatility.criticalForce).toBe(20);
    expect(result.momentum.lookback).toBe(DEFAULT_FORCE_PARAMS.momentum.lookback);
  });

  test("overrides only rsThreshold", () => {
    const result = mergeForceParams({ rsThreshold: 0.15 });
    expect(result.rsThreshold).toBe(0.15);
    expect(result.volatility).toEqual(DEFAULT_FORCE_PARAMS.volatility);
    expect(result.baseRange).toEqual(DEFAULT_FORCE_PARAMS.baseRange);
  });

  test("partial trend overrides merge correctly", () => {
    const result = mergeForceParams({
      trend: { lookback: 72, bullishFrom: 65, bearishFrom: 35, biasExp: 0.02, biasDivider: 4 },
    });
    expect(result.trend.lookback).toBe(72);
    expect(result.trend.bullishFrom).toBe(65);
    expect(result.trend.bearishFrom).toBe(35);
    expect(result.trend.biasExp).toBe(0.02);
    expect(result.trend.biasDivider).toBe(4);
  });

  test("baseRange partial override", () => {
    const result = mergeForceParams({
      baseRange: { min: 0.001, max: 0.05, vforceExp: -0.5, vforceDivider: 400 },
    });
    expect(result.baseRange.min).toBe(0.001);
    expect(result.baseRange.max).toBe(0.05);
    expect(result.baseRange.vforceExp).toBe(-0.5);
    expect(result.baseRange.vforceDivider).toBe(400);
  });

  test("returns a fresh object (no mutation of defaults)", () => {
    const r1 = mergeForceParams();
    const r2 = mergeForceParams();
    r1.rsThreshold = 999;
    expect(r2.rsThreshold).toBe(DEFAULT_FORCE_PARAMS.rsThreshold);
  });
});

// ---- buildKillSwitchState ----
// Uses real in-memory DB with known data to test the query composition.

import {
  initPairStore,
  savePairAllocation,
  logTx,
  getRecentYields,
  getRecentRsTimestamps,
  getTrailingTxCount,
} from "../../src/data/store";

describe("buildKillSwitchState", () => {
  let db: Database;

  beforeEach(() => {
    db = initPairStore("KS-TEST", ":memory:");
  });

  test("empty DB yields empty state", () => {
    const yields = getRecentYields(db, 24);
    const rsTs = getRecentRsTimestamps(db, Date.now() - 4 * 3600_000);
    const txCount = getTrailingTxCount(db, Date.now() - 24 * 3600_000);
    expect(yields).toHaveLength(0);
    expect(rsTs).toHaveLength(0);
    expect(txCount).toBe(0);
    const state = { trailingYields: yields, rsTimestamps: rsTs, trailing24hGasUsd: txCount * 0.5 };
    expect(state.trailing24hGasUsd).toBe(0);
  });

  test("builds state from DB with allocations and tx logs", () => {
    const now = Date.now();

    for (let i = 0; i < 5; i++) {
      savePairAllocation(db, {
        ts: now - (5 - i) * 60_000,
        currentApr: 0.01 * (i + 1),
        optimalApr: 0.02,
        improvement: 0.1,
        decision: i % 2 === 0 ? "RS" : "HOLD",
        targetAllocations: [],
        currentAllocations: [],
      });
    }

    for (let i = 0; i < 3; i++) {
      const entry: TxLogEntry = {
        ts: now - i * 1000,
        decisionType: "PRA",
        opType: "mint",
        pool: "0x0000000000000000000000000000000000000001",
        chain: 1,
        txHash: `0x${i.toString().padStart(64, "0")}` as `0x${string}`,
        status: "success",
        gasUsed: 150000n,
        gasPrice: 20000000000n,
        inputToken: "USDC",
        inputAmount: "1000000",
        inputUsd: 1000,
        outputToken: "USDT",
        outputAmount: "999000",
        outputUsd: 999,
        targetAllocationPct: 0.5,
        actualAllocationPct: 0.48,
        allocationErrorPct: 0.02,
      };
      logTx(db, entry);
    }

    const yields = getRecentYields(db, 24);
    expect(yields).toHaveLength(5);
    expect(yields[0]).toBe(0.01);
    expect(yields[4]).toBe(0.05);

    const rsTs = getRecentRsTimestamps(db, now - 4 * 3600_000);
    expect(rsTs).toHaveLength(3);

    const txCount = getTrailingTxCount(db, now - 24 * 3600_000);
    expect(txCount).toBe(3);

    const gasCost = 0.5;
    const state = {
      trailingYields: yields,
      rsTimestamps: rsTs,
      trailing24hGasUsd: txCount * gasCost,
    };
    expect(state.trailing24hGasUsd).toBe(1.5);
  });

  test("getRecentYields returns in chronological order", () => {
    const now = Date.now();
    savePairAllocation(db, {
      ts: now - 2000,
      currentApr: 0.1,
      optimalApr: 0.12,
      improvement: 0.2,
      decision: "HOLD",
      targetAllocations: [],
      currentAllocations: [],
    });
    savePairAllocation(db, {
      ts: now - 1000,
      currentApr: 0.2,
      optimalApr: 0.22,
      improvement: 0.1,
      decision: "HOLD",
      targetAllocations: [],
      currentAllocations: [],
    });

    const yields = getRecentYields(db, 24);
    expect(yields).toHaveLength(2);
    // reversed: oldest first
    expect(yields[0]).toBe(0.1);
    expect(yields[1]).toBe(0.2);
  });

  test("getRecentRsTimestamps only returns RS decisions after cutoff", () => {
    const now = Date.now();
    const cutoff = now - 1 * 3600_000;
    // One RS before cutoff (should be excluded)
    savePairAllocation(db, {
      ts: cutoff - 60_000,
      currentApr: 0.1,
      optimalApr: 0.12,
      improvement: 0.2,
      decision: "RS",
      targetAllocations: [],
      currentAllocations: [],
    });
    // One RS after cutoff (should be included)
    savePairAllocation(db, {
      ts: now - 30_000,
      currentApr: 0.1,
      optimalApr: 0.12,
      improvement: 0.2,
      decision: "RS",
      targetAllocations: [],
      currentAllocations: [],
    });
    // One HOLD after cutoff (should be excluded, wrong decision type)
    savePairAllocation(db, {
      ts: now - 10_000,
      currentApr: 0.1,
      optimalApr: 0.12,
      improvement: 0.2,
      decision: "HOLD",
      targetAllocations: [],
      currentAllocations: [],
    });

    const rsTs = getRecentRsTimestamps(db, cutoff);
    expect(rsTs).toHaveLength(1);
    expect(rsTs[0]).toBe(now - 30_000);
  });
});
