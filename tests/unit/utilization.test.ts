import { describe, expect, test } from "bun:test";
import { computePoolAnalyses } from "../../src/strategy/utilization";
import type { PoolSnapshot, PoolConfig } from "../../src/types";
import { neutralForces } from "../helpers";

function snap(pool: string, chain: number, overrides: Partial<PoolSnapshot> = {}): PoolSnapshot {
  return {
    pool: pool as `0x${string}`,
    chain,
    ts: Date.now(),
    volume24h: 1_000_000,
    tvl: 10_000_000,
    feePct: 0.0005,
    basePriceUsd: 1,
    quotePriceUsd: 1,
    exchangeRate: 1,
    priceChangeH1: 0,
    priceChangeH24: 0,
    ...overrides,
  };
}

const pool1: PoolConfig = {
  address: "0x0000000000000000000000000000000000000001",
  chain: 1,
  dex: "uniswap_v3",
};
const pool2: PoolConfig = {
  address: "0x0000000000000000000000000000000000000002",
  chain: 42161,
  dex: "uniswap_v3",
};

describe("computePoolAnalyses", () => {
  test("single pool with no previous snapshot", () => {
    const snapshots = [snap(pool1.address, pool1.chain)];
    const prevSnapshots = new Map<string, PoolSnapshot | null>();
    prevSnapshots.set(`${pool1.chain}:${pool1.address}`, null);

    const analyses = computePoolAnalyses(
      snapshots,
      prevSnapshots,
      [pool1],
      neutralForces(5),
      900,
      Date.now(),
    );

    expect(analyses).toHaveLength(1);
    expect(analyses[0].pool).toBe(pool1.address);
    expect(analyses[0].apr).toBeGreaterThan(0);
    expect(analyses[0].feePct).toBe(0.0005);
    expect(analyses[0].tvl).toBe(10_000_000);
  });

  test("multiple pools sorted by APR descending", () => {
    const s1 = snap(pool1.address, pool1.chain, { volume24h: 500_000, tvl: 10_000_000 });
    const s2 = snap(pool2.address, pool2.chain, { volume24h: 2_000_000, tvl: 5_000_000 });
    const prevSnapshots = new Map<string, PoolSnapshot | null>();
    prevSnapshots.set(`${pool1.chain}:${pool1.address}`, null);
    prevSnapshots.set(`${pool2.chain}:${pool2.address}`, null);

    const analyses = computePoolAnalyses(
      [s1, s2],
      prevSnapshots,
      [pool1, pool2],
      neutralForces(5),
      900,
      Date.now(),
    );

    expect(analyses).toHaveLength(2);
    // Higher volume/tvl ratio = higher APR = sorted first
    expect(analyses[0].apr).toBeGreaterThanOrEqual(analyses[1].apr);
  });

  test("interval volume from diff when previous snapshot exists", () => {
    const now = Date.now();
    const prev = snap(pool1.address, pool1.chain, { volume24h: 900_000, ts: now - 900_000 });
    const current = snap(pool1.address, pool1.chain, { volume24h: 1_000_000, ts: now });
    const prevSnapshots = new Map<string, PoolSnapshot | null>();
    prevSnapshots.set(`${pool1.chain}:${pool1.address}`, prev);

    const analyses = computePoolAnalyses(
      [current],
      prevSnapshots,
      [pool1],
      neutralForces(5),
      900,
      now,
    );

    // Diff = 1_000_000 - 900_000 = 100_000
    expect(analyses[0].intervalVolume).toBe(100_000);
  });

  test("zero TVL defaults to 1 to avoid division by zero", () => {
    const s = snap(pool1.address, pool1.chain, { tvl: 0 });
    const prevSnapshots = new Map<string, PoolSnapshot | null>();
    prevSnapshots.set(`${pool1.chain}:${pool1.address}`, null);

    const analyses = computePoolAnalyses(
      [s],
      prevSnapshots,
      [pool1],
      neutralForces(5),
      900,
      Date.now(),
    );

    expect(analyses[0].tvl).toBe(1);
    expect(Number.isFinite(analyses[0].apr)).toBe(true);
  });

  test("forces propagated to analysis", () => {
    const forces = neutralForces(5);
    forces.v.force = 42;
    forces.m.force = 65;
    forces.t.force = 30;

    const s = snap(pool1.address, pool1.chain);
    const prevSnapshots = new Map<string, PoolSnapshot | null>();
    prevSnapshots.set(`${pool1.chain}:${pool1.address}`, null);

    const analyses = computePoolAnalyses([s], prevSnapshots, [pool1], forces, 900, Date.now());

    expect(analyses[0].vforce).toBe(42);
    expect(analyses[0].mforce).toBe(65);
    expect(analyses[0].tforce).toBe(30);
  });
});
