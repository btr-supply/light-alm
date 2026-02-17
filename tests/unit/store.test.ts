import { describe, expect, test } from "bun:test";
import {
  initPairStore,
  saveCandles,
  getCandles,
  getLatestCandleTs,
  saveSnapshot,
  getLastSnapshot,
  savePosition,
  getPositions,
  deletePosition,
  savePoolAnalyses,
  getPoolAnalyses,
  savePairAllocation,
  getLatestPairAllocation,
  getPairAllocations,
  saveEpochSnapshot,
  getEpochSnapshots,
  logTx,
  getTxLogs,
  pruneOldData,
} from "../../src/data/store";
import type { PoolSnapshot, PoolAnalysis, TxLogEntry } from "../../src/types";

const db = initPairStore("TEST", ":memory:");

describe("M1 candles", () => {
  test("save and retrieve candles", () => {
    const candles = [
      { ts: 1000, o: 1, h: 1.1, l: 0.9, c: 1.05, v: 500 },
      { ts: 2000, o: 1.05, h: 1.15, l: 0.95, c: 1.1, v: 600 },
    ];
    saveCandles(db, candles);
    const result = getCandles(db, 0, 3000);
    expect(result).toHaveLength(2);
    expect(result[0].ts).toBe(1000);
    expect(result[1].c).toBe(1.1);
  });

  test("getLatestCandleTs", () => {
    expect(getLatestCandleTs(db)).toBe(2000);
  });

  test("upsert on duplicate ts", () => {
    saveCandles(db, [{ ts: 1000, o: 2, h: 2.1, l: 1.9, c: 2.05, v: 700 }]);
    const result = getCandles(db, 1000, 1000);
    expect(result).toHaveLength(1);
    expect(result[0].o).toBe(2); // updated
  });
});

describe("pool snapshots", () => {
  test("save and retrieve last snapshot", () => {
    const addr = "0x0000000000000000000000000000000000000001" as `0x${string}`;
    const snap1: PoolSnapshot = {
      pool: addr,
      chain: 1,
      ts: 100,
      volume24h: 50000,
      tvl: 1e6,
      feePct: 0.0005,
      basePriceUsd: 1.0,
      quotePriceUsd: 1.0,
      exchangeRate: 1.0,
      priceChangeH1: 0,
      priceChangeH24: 0,
    };
    const snap2: PoolSnapshot = {
      ...snap1,
      ts: 200,
      volume24h: 60000,
      tvl: 1.1e6,
    };
    saveSnapshot(db, snap1);
    saveSnapshot(db, snap2);

    const last = getLastSnapshot(db, addr, 1, 200);
    expect(last).not.toBeNull();
    expect(last!.ts).toBe(100);
    expect(last!.basePriceUsd).toBe(1.0);
  });

  test("returns null when no prior snapshot", () => {
    expect(getLastSnapshot(db, "0x0000000000000000000000000000000000000099", 1, 100)).toBeNull();
  });
});

describe("positions", () => {
  test("CRUD lifecycle", () => {
    const pos = {
      id: "test-1",
      pool: "0x0000000000000000000000000000000000000001" as `0x${string}`,
      chain: 1,
      dex: "uniswap_v3",
      positionId: "123",
      tickLower: -100,
      tickUpper: 100,
      liquidity: 1000n,
      amount0: 500n,
      amount1: 500n,
      entryPrice: 1.0,
      entryTs: Date.now(),
      entryApr: 0.15,
      entryValueUsd: 1000,
    };

    savePosition(db, pos);
    let positions = getPositions(db);
    expect(positions).toHaveLength(1);
    expect(positions[0].liquidity).toBe(1000n);
    expect(positions[0].entryValueUsd).toBe(1000);

    deletePosition(db, "test-1");
    positions = getPositions(db);
    expect(positions).toHaveLength(0);
  });
});

describe("pool analysis", () => {
  const analysisTs = 999000;
  const addr = "0x0000000000000000000000000000000000000001" as `0x${string}`;

  test("save and retrieve pool analyses (round-trip)", () => {
    const analyses: PoolAnalysis[] = [
      {
        pool: addr,
        chain: 1,
        ts: analysisTs,
        intervalVolume: 10000,
        feePct: 0.0005,
        feesGenerated: 5,
        tvl: 1e6,
        utilization: 0.000005,
        apr: 0.105,
        exchangeRate: 1.0,
        basePriceUsd: 1.0,
        vforce: 5,
        mforce: 50,
        tforce: 50,
        rangeMin: 0.998,
        rangeMax: 1.002,
        rangeBreadth: 0.004,
        rangeBias: 0,
        rangeConfidence: 95,
      },
    ];
    savePoolAnalyses(db, analyses);

    const rows = getPoolAnalyses(db, addr, 1);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const row = rows.find((r) => r.ts === analysisTs)!;
    expect(row).toBeDefined();
    expect(row.feesGenerated).toBe(5);
    expect(row.feePct).toBe(0.0005);
    expect(row.intervalVolume).toBe(10000);
    expect(row.utilization).toBe(0.000005);
    expect(row.apr).toBe(0.105);
    expect(row.tvl).toBe(1e6);
    expect(row.vforce).toBe(5);
    expect(row.rangeMin).toBe(0.998);
  });

  test("filter by time range", () => {
    savePoolAnalyses(db, [
      {
        pool: addr,
        chain: 1,
        ts: analysisTs + 1000,
        intervalVolume: 20000,
        feePct: 0.0005,
        feesGenerated: 10,
        tvl: 2e6,
        utilization: 0.000005,
        apr: 0.105,
        exchangeRate: 1.0,
        basePriceUsd: 1.0,
        vforce: 5,
        mforce: 50,
        tforce: 50,
        rangeMin: 0.997,
        rangeMax: 1.003,
        rangeBreadth: 0.006,
        rangeBias: 0,
        rangeConfidence: 90,
      },
    ]);

    const all = getPoolAnalyses(db, addr, 1);
    expect(all.length).toBeGreaterThanOrEqual(2);

    const filtered = getPoolAnalyses(db, addr, 1, analysisTs + 500);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].feesGenerated).toBe(10);
  });
});

describe("pair allocation", () => {
  test("save and retrieve pair allocation", () => {
    savePairAllocation(db, {
      ts: Date.now(),
      currentApr: 0.1,
      optimalApr: 0.12,
      improvement: 0.2,
      decision: "HOLD",
      targetAllocations: [
        {
          pool: "0x0000000000000000000000000000000000000001",
          chain: 1,
          dex: "uniswap_v3",
          pct: 1,
          expectedApr: 0.12,
        },
      ],
      currentAllocations: [],
    });

    const latest = getLatestPairAllocation(db);
    expect(latest).not.toBeNull();
    expect(latest!.decision).toBe("HOLD");
    expect(latest!.targetAllocations).toHaveLength(1);
  });
});

describe("tx log", () => {
  test("log and retrieve transactions", () => {
    const entry: TxLogEntry = {
      ts: Date.now(),
      decisionType: "PRA",
      opType: "mint",
      pool: "0x0000000000000000000000000000000000000001",
      chain: 1,
      txHash: "0x0000000000000000000000000000000000000000000000000000000000000abc",
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
    expect(() => logTx(db, entry)).not.toThrow();

    const logs = getTxLogs(db, 10);
    expect(logs).toHaveLength(1);
    expect(logs[0].opType).toBe("mint");
    expect(logs[0].gasUsed).toBe(150000n);
  });
});

describe("epoch snapshots", () => {
  const snapDb = initPairStore("SNAP-TEST", ":memory:");

  test("save and retrieve epoch snapshot", () => {
    saveEpochSnapshot(snapDb, {
      pairId: "USDC-USDT",
      epoch: 1,
      ts: 1000000,
      decision: "HOLD",
      portfolioValueUsd: 5000,
      feesEarnedUsd: 0,
      gasSpentUsd: 0,
      ilUsd: 0,
      netPnlUsd: 0,
      rangeEfficiency: 0,
      currentApr: 0.1,
      optimalApr: 0.12,
      positionsCount: 2,
    });

    const snapshots = getEpochSnapshots(snapDb, "USDC-USDT");
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].pairId).toBe("USDC-USDT");
    expect(snapshots[0].epoch).toBe(1);
    expect(snapshots[0].decision).toBe("HOLD");
    expect(snapshots[0].portfolioValueUsd).toBe(5000);
    expect(snapshots[0].currentApr).toBe(0.1);
    expect(snapshots[0].optimalApr).toBe(0.12);
    expect(snapshots[0].positionsCount).toBe(2);
  });

  test("upsert on duplicate pair_id + epoch", () => {
    saveEpochSnapshot(snapDb, {
      pairId: "USDC-USDT",
      epoch: 1,
      ts: 1000001,
      decision: "PRA",
      portfolioValueUsd: 6000,
      feesEarnedUsd: 10,
      gasSpentUsd: 5,
      ilUsd: 1,
      netPnlUsd: 4,
      rangeEfficiency: 0.5,
      currentApr: 0.11,
      optimalApr: 0.13,
      positionsCount: 3,
    });

    const snapshots = getEpochSnapshots(snapDb, "USDC-USDT");
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].decision).toBe("PRA");
    expect(snapshots[0].portfolioValueUsd).toBe(6000);
  });

  test("filter by time range", () => {
    saveEpochSnapshot(snapDb, {
      pairId: "USDC-USDT",
      epoch: 2,
      ts: 2000000,
      decision: "RS",
      portfolioValueUsd: 7000,
      feesEarnedUsd: 0,
      gasSpentUsd: 0,
      ilUsd: 0,
      netPnlUsd: 0,
      rangeEfficiency: 0,
      currentApr: 0.15,
      optimalApr: 0.18,
      positionsCount: 1,
    });

    const filtered = getEpochSnapshots(snapDb, "USDC-USDT", 1500000);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].epoch).toBe(2);

    const ranged = getEpochSnapshots(snapDb, "USDC-USDT", 0, 1500000);
    expect(ranged).toHaveLength(1);
    expect(ranged[0].epoch).toBe(1);
  });

  test("limit parameter", () => {
    const limited = getEpochSnapshots(snapDb, "USDC-USDT", undefined, undefined, 1);
    expect(limited).toHaveLength(1);
    expect(limited[0].epoch).toBe(1); // ASC order, first epoch
  });

  test("returns empty for unknown pair", () => {
    const snapshots = getEpochSnapshots(snapDb, "UNKNOWN-PAIR");
    expect(snapshots).toHaveLength(0);
  });
});

describe("pair allocations (historical)", () => {
  const allocDb = initPairStore("ALLOC-TEST", ":memory:");

  test("getPairAllocations returns multiple in DESC order", () => {
    const now = Date.now();
    for (let i = 0; i < 3; i++) {
      savePairAllocation(allocDb, {
        ts: now + i * 1000,
        currentApr: 0.1 + i * 0.01,
        optimalApr: 0.12 + i * 0.01,
        improvement: 0.2,
        decision: "HOLD",
        targetAllocations: [],
        currentAllocations: [],
      });
    }

    const allocs = getPairAllocations(allocDb, 10);
    expect(allocs).toHaveLength(3);
    // DESC order: newest first
    expect(allocs[0].currentApr).toBeCloseTo(0.12);
    expect(allocs[2].currentApr).toBeCloseTo(0.1);
  });

  test("getPairAllocations respects limit", () => {
    const allocs = getPairAllocations(allocDb, 2);
    expect(allocs).toHaveLength(2);
  });
});

describe("pruneOldData", () => {
  const pruneDb = initPairStore("PRUNE-TEST", ":memory:");

  test("deletes rows older than retention, keeps recent", () => {
    const now = Date.now();
    const oldTs = now - 100 * 86_400_000; // 100 days ago
    const recentTs = now - 10 * 86_400_000; // 10 days ago
    const addr = "0x0000000000000000000000000000000000000099" as `0x${string}`;

    // Insert old + recent candles
    saveCandles(pruneDb, [
      { ts: oldTs, o: 1, h: 1.1, l: 0.9, c: 1.0, v: 100 },
      { ts: recentTs, o: 1, h: 1.1, l: 0.9, c: 1.0, v: 200 },
    ]);

    // Insert old + recent pair allocations
    savePairAllocation(pruneDb, {
      ts: oldTs,
      currentApr: 0.1,
      optimalApr: 0.12,
      improvement: 0.2,
      decision: "HOLD",
      targetAllocations: [],
      currentAllocations: [],
    });
    savePairAllocation(pruneDb, {
      ts: recentTs,
      currentApr: 0.15,
      optimalApr: 0.18,
      improvement: 0.2,
      decision: "PRA",
      targetAllocations: [],
      currentAllocations: [],
    });

    // Insert old + recent pool analyses
    const baseAnalysis = {
      pool: addr,
      chain: 1,
      intervalVolume: 1000,
      feePct: 0.0005,
      feesGenerated: 1,
      tvl: 1e6,
      utilization: 0.001,
      apr: 0.1,
      exchangeRate: 1.0,
      basePriceUsd: 1.0,
      vforce: 5,
      mforce: 50,
      tforce: 50,
      rangeMin: 0.99,
      rangeMax: 1.01,
      rangeBreadth: 0.02,
      rangeBias: 0,
      rangeConfidence: 90,
    };
    savePoolAnalyses(pruneDb, [
      { ...baseAnalysis, ts: oldTs },
      { ...baseAnalysis, ts: recentTs },
    ]);

    // Insert old + recent pool snapshots
    const baseSnapshot: PoolSnapshot = {
      pool: addr,
      chain: 1,
      volume24h: 50000,
      tvl: 1e6,
      feePct: 0.0005,
      basePriceUsd: 1.0,
      quotePriceUsd: 1.0,
      exchangeRate: 1.0,
      priceChangeH1: 0,
      priceChangeH24: 0,
      ts: 0,
    };
    saveSnapshot(pruneDb, { ...baseSnapshot, ts: oldTs });
    saveSnapshot(pruneDb, { ...baseSnapshot, ts: recentTs });

    // Insert old + recent tx_log entries
    const baseTx: TxLogEntry = {
      ts: 0,
      decisionType: "PRA",
      opType: "mint",
      pool: addr,
      chain: 1,
      txHash: "0x0000000000000000000000000000000000000000000000000000000000000001" as `0x${string}`,
      status: "success",
      gasUsed: 100000n,
      gasPrice: 1000000000n,
      inputToken: "",
      inputAmount: "0",
      inputUsd: 0,
      outputToken: "",
      outputAmount: "0",
      outputUsd: 0,
      targetAllocationPct: 1,
      actualAllocationPct: 1,
      allocationErrorPct: 0,
    };
    logTx(pruneDb, { ...baseTx, ts: oldTs });
    logTx(pruneDb, { ...baseTx, ts: recentTs });

    // Insert old + recent epoch snapshots
    const baseEpoch = {
      pairId: "PRUNE-TEST",
      decision: "HOLD" as const,
      portfolioValueUsd: 5000,
      feesEarnedUsd: 0,
      gasSpentUsd: 0,
      ilUsd: 0,
      netPnlUsd: 0,
      rangeEfficiency: 0,
      currentApr: 0.1,
      optimalApr: 0.12,
      positionsCount: 1,
    };
    saveEpochSnapshot(pruneDb, { ...baseEpoch, epoch: 1, ts: oldTs });
    saveEpochSnapshot(pruneDb, { ...baseEpoch, epoch: 2, ts: recentTs });

    // Prune with 90-day retention
    pruneOldData(pruneDb, 90);

    // Old candle gone, recent survives
    const candles = getCandles(pruneDb, 0, now);
    expect(candles).toHaveLength(1);
    expect(candles[0].ts).toBe(recentTs);

    // Old allocation gone, recent survives
    const allocs = getPairAllocations(pruneDb, 100);
    expect(allocs).toHaveLength(1);
    expect(allocs[0].decision).toBe("PRA");

    // Old pool analysis gone, recent survives
    const analyses = getPoolAnalyses(pruneDb, addr, 1);
    expect(analyses).toHaveLength(1);
    expect(analyses[0].ts).toBe(recentTs);

    // Old pool snapshot gone, recent survives
    const snap = getLastSnapshot(pruneDb, addr, 1, now + 1);
    expect(snap).not.toBeNull();
    expect(snap!.ts).toBe(recentTs);

    // Old tx_log gone, recent survives
    const txs = getTxLogs(pruneDb, 100);
    expect(txs).toHaveLength(1);
    expect(txs[0].ts).toBe(recentTs);

    // Old epoch snapshot gone, recent survives
    const epochs = getEpochSnapshots(pruneDb, "PRUNE-TEST");
    expect(epochs).toHaveLength(1);
    expect(epochs[0].ts).toBe(recentTs);
  });
});
