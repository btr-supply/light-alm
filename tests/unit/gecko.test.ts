import { describe, expect, test } from "bun:test";
import { intervalVolume } from "../../src/data/gecko";
import type { PoolSnapshot } from "../../src/types";

function snap(vol24h: number, ts = 1000): PoolSnapshot {
  return {
    pool: "0x0000000000000000000000000000000000000001",
    chain: 1,
    ts,
    volume24h: vol24h,
    tvl: 1e6,
    feePct: 0.0005,
    basePriceUsd: 1.0,
    quotePriceUsd: 1.0,
    exchangeRate: 1.0,
    priceChangeH1: 0,
    priceChangeH24: 0,
  };
}

describe("intervalVolume", () => {
  test("diff consecutive snapshots", () => {
    const prev = snap(100_000, 0);
    const curr = snap(110_000, 900);
    expect(intervalVolume(curr, prev, 900)).toBe(10_000);
  });

  test("negative diff (24h roll) falls back to proportional", () => {
    const prev = snap(200_000, 0);
    const curr = snap(50_000, 900);
    // 50000 / (86400 / 900) = 50000 / 96 ≈ 520.83
    expect(intervalVolume(curr, prev, 900)).toBeCloseTo(50_000 / 96, 1);
  });

  test("no previous = proportional estimate", () => {
    const curr = snap(96_000, 900);
    expect(intervalVolume(curr, null, 900)).toBeCloseTo(1000, 0);
  });
});
