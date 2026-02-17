import { describe, expect, test } from "bun:test";
import { waterFill, weightedApr } from "../../src/strategy/allocation";
import type { PoolAnalysis, PoolConfig, AllocationEntry } from "../../src/types";

function pool(i: number): PoolConfig {
  return {
    address: `0x${i.toString().padStart(40, "0")}` as `0x${string}`,
    chain: 1,
    dex: "uniswap_v3",
  };
}

function analysis(i: number, apr: number, tvl: number): PoolAnalysis {
  return {
    pool: pool(i).address,
    chain: 1,
    ts: Date.now(),
    intervalVolume: 0,
    feePct: 0.0005,
    feesGenerated: 0,
    tvl,
    utilization: 0,
    apr,
    exchangeRate: 1,
    basePriceUsd: 1,
    vforce: 5,
    mforce: 50,
    tforce: 50,
    rangeMin: 0.999,
    rangeMax: 1.001,
    rangeBreadth: 0.002,
    rangeBias: 0,
    rangeConfidence: 95,
  };
}

const pools = Array.from({ length: 10 }, (_, i) => pool(i));

describe("waterFill", () => {
  test("single pool gets 100%", () => {
    const allocs = waterFill([analysis(1, 0.15, 1e6)], [pool(1)], 3);
    expect(allocs).toHaveLength(1);
    expect(allocs[0].pct).toBe(1);
  });

  test("allocations sum to 1", () => {
    const analyses = [analysis(1, 0.2, 1e6), analysis(2, 0.15, 2e6), analysis(3, 0.1, 3e6)];
    // Capital larger than pool TVLs creates meaningful dilution, spreading allocation
    const allocs = waterFill(analyses, [pool(1), pool(2), pool(3)], 3, 5e6);
    const total = allocs.reduce((s, a) => s + a.pct, 0);
    expect(total).toBeCloseTo(1, 5);
  });

  test("higher APR pool gets more allocation", () => {
    const analyses = [analysis(1, 0.3, 1e6), analysis(2, 0.15, 2e6), analysis(3, 0.1, 3e6)];
    // Capital larger than pool TVLs creates meaningful dilution, spreading allocation
    const allocs = waterFill(analyses, [pool(1), pool(2), pool(3)], 3, 5e6);
    expect(allocs.length).toBeGreaterThanOrEqual(2);
    const sorted = [...allocs].sort((a, b) => b.pct - a.pct);
    expect(sorted[0].expectedApr).toBeGreaterThanOrEqual(sorted[sorted.length - 1].expectedApr);
  });

  test("small capital relative to TVL concentrates in best pool", () => {
    // With $10K capital and $1M+ pools, dilution is negligible — best pool gets everything
    const analyses = [analysis(1, 0.3, 1e6), analysis(2, 0.15, 2e6), analysis(3, 0.1, 3e6)];
    const allocs = waterFill(analyses, [pool(1), pool(2), pool(3)], 3, 10_000);
    expect(allocs).toHaveLength(1);
    expect(allocs[0].pool).toBe(pool(1).address);
  });

  test("respects maxPositions", () => {
    const analyses = Array.from({ length: 10 }, (_, i) => analysis(i, 0.1 + i * 0.01, 1e6));
    const allocs = waterFill(analyses, pools, 2);
    expect(allocs.length).toBeLessThanOrEqual(2);
  });

  test("zero APR pools excluded", () => {
    const allocs = waterFill([analysis(1, 0, 1e6), analysis(2, 0, 1e6)], [pool(1), pool(2)], 3);
    expect(allocs).toHaveLength(0);
  });

  test("empty input", () => {
    expect(waterFill([], [], 3)).toHaveLength(0);
  });

  test("allocation entries contain pool/chain/dex", () => {
    const allocs = waterFill([analysis(1, 0.15, 1e6)], [pool(1)], 3);
    expect(allocs[0].pool).toBe(pool(1).address);
    expect(allocs[0].chain).toBe(1);
    expect(allocs[0].dex).toBe("uniswap_v3");
  });
});

describe("weightedApr", () => {
  test("single allocation", () => {
    const entry: AllocationEntry = {
      pool: pool(1).address,
      chain: 1,
      dex: "uniswap_v3",
      pct: 1,
      expectedApr: 0.15,
    };
    expect(weightedApr([entry])).toBeCloseTo(0.15);
  });

  test("weighted blend", () => {
    const entries: AllocationEntry[] = [
      { pool: pool(1).address, chain: 1, dex: "uniswap_v3", pct: 0.6, expectedApr: 0.2 },
      { pool: pool(2).address, chain: 1, dex: "uniswap_v3", pct: 0.4, expectedApr: 0.1 },
    ];
    expect(weightedApr(entries)).toBeCloseTo(0.16, 5);
  });
});
