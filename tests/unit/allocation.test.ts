import { describe, expect, test } from "bun:test";
import { allocate, maxWeightBp, weightedApr, WEIGHT_MODEL } from "../../src/strategy/allocation";
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

const pools = Array.from({ length: 20 }, (_, i) => pool(i));

describe("allocate", () => {
  test("single pool gets 100%", () => {
    const allocs = allocate([analysis(1, 0.15, 1e6)], [pool(1)], 3);
    expect(allocs).toHaveLength(1);
    expect(allocs[0].pct).toBe(1);
  });

  test("allocations sum to 1", () => {
    const analyses = [analysis(1, 0.2, 1e6), analysis(2, 0.15, 2e6), analysis(3, 0.1, 3e6)];
    const allocs = allocate(analyses, [pool(1), pool(2), pool(3)], 3);
    const total = allocs.reduce((s, a) => s + a.pct, 0);
    expect(total).toBeCloseTo(1, 2);
  });

  test("higher APR pool gets more allocation", () => {
    const analyses = [analysis(1, 0.3, 1e6), analysis(2, 0.15, 2e6), analysis(3, 0.1, 3e6)];
    const allocs = allocate(analyses, [pool(1), pool(2), pool(3)], 3);
    expect(allocs.length).toBeGreaterThanOrEqual(2);
    const sorted = [...allocs].sort((a, b) => b.pct - a.pct);
    expect(sorted[0].expectedApr).toBeGreaterThanOrEqual(sorted[sorted.length - 1].expectedApr);
  });

  test("respects maxPositions", () => {
    const analyses = Array.from({ length: 10 }, (_, i) => analysis(i, 0.1 + i * 0.01, 1e6));
    const allocs = allocate(analyses, pools, 2);
    expect(allocs.length).toBeLessThanOrEqual(2);
  });

  test("zero APR pools excluded", () => {
    const allocs = allocate([analysis(1, 0, 1e6), analysis(2, 0, 1e6)], [pool(1), pool(2)], 3);
    expect(allocs).toHaveLength(0);
  });

  test("empty input", () => {
    expect(allocate([], [], 3)).toHaveLength(0);
  });

  test("allocation entries contain pool/chain/dex", () => {
    const allocs = allocate([analysis(1, 0.15, 1e6)], [pool(1)], 3);
    expect(allocs[0].pool).toBe(pool(1).address);
    expect(allocs[0].chain).toBe(1);
    expect(allocs[0].dex).toBe("uniswap_v3");
  });

  test("higher capital lowers max weight per pool (with enough pools)", () => {
    // Use very uneven APR/TVL so the top pool would hit the cap without capital constraint.
    // 5 pools: one dominant pool (high APR + high TVL), rest much weaker.
    const analyses = [
      analysis(0, 0.50, 10e6), // dominant
      analysis(1, 0.10, 1e6),
      analysis(2, 0.08, 1e6),
      analysis(3, 0.06, 1e6),
      analysis(4, 0.04, 1e6),
    ];
    const ps = [pool(0), pool(1), pool(2), pool(3), pool(4)];

    // Small capital: cap is count-based only (~4735bp for 5 pools)
    const smallCap = allocate(analyses, ps, 5, 10_000);
    // Large capital ($2M): capitalCap ≈ 800 + 5000*exp(-2M/750k) ≈ 800+345 = 1145
    // but feasibility(5) = 2000, so effective cap = 2000
    const largeCap = allocate(analyses, ps, 5, 2_000_000);

    const maxSmall = Math.max(...smallCap.map((a) => a.pct));
    const maxLarge = Math.max(...largeCap.map((a) => a.pct));
    expect(maxSmall).toBeGreaterThan(maxLarge);
  });

  test("$10M capital with 15 pools forces broad diversification", () => {
    const analyses = Array.from({ length: 15 }, (_, i) =>
      analysis(i, 0.10 + i * 0.005, 5e6),
    );
    const ps = Array.from({ length: 15 }, (_, i) => pool(i));
    const allocs = allocate(analyses, ps, 15, 10_000_000);
    // At $10M with 15 pools, capital floor = 800bp = 8%, feasibility = ceil(10000/15) = 667
    // Effective cap = max(min(countCap, 800), 667) = 800bp = 8%
    for (const a of allocs) {
      expect(a.pct).toBeLessThanOrEqual(0.10);
    }
  });
});

describe("maxWeightBp", () => {
  test("without capital, uses pool-count-only formula", () => {
    const cap3 = maxWeightBp(3);
    const cap10 = maxWeightBp(10);
    expect(cap3).toBeGreaterThan(cap10);
    // For 3 pools without capital, should be well above 50%
    expect(cap3).toBeGreaterThan(5000);
  });

  test("with small capital ($10k) and many pools, cap stays high", () => {
    // 10 pools: feasibility = 1000, countCap ~3000, capitalCap ~5733
    const cap = maxWeightBp(10, 10_000);
    expect(cap).toBeGreaterThan(2500);
  });

  test("with $1M capital and 10 pools, capital cap binds", () => {
    // countCap(10) ≈ 3000, capitalCap(1M) ≈ 2118, feasibility(10) = 1000
    // result = max(min(3000, 2118), 1000) = 2118
    const cap = maxWeightBp(10, 1_000_000);
    expect(cap).toBeGreaterThanOrEqual(1500);
    expect(cap).toBeLessThanOrEqual(2500);
  });

  test("with $10M capital and many pools, cap converges to floor", () => {
    // 15 pools: feasibility = 667, capitalCap ~800, countCap ~2717
    // result = max(min(2717, 800), 667) = 800
    const cap = maxWeightBp(15, 10_000_000);
    expect(cap).toBeLessThanOrEqual(WEIGHT_MODEL.capitalFloorBp + 50);
    expect(cap).toBeGreaterThanOrEqual(WEIGHT_MODEL.capitalFloorBp);
  });

  test("feasibility floor prevents impossible caps", () => {
    // 3 pools: min possible weight = ceil(10000/3) = 3334
    // Even at $10M, cap cannot go below 3334 with only 3 pools
    const cap = maxWeightBp(3, 10_000_000);
    expect(cap).toBe(Math.ceil(10000 / 3));
  });

  test("undefined capital falls back to count-only", () => {
    expect(maxWeightBp(3, undefined)).toBe(maxWeightBp(3));
  });

  test("capital cap decreases monotonically with capital", () => {
    const n = 20; // enough pools to avoid feasibility domination
    const caps = [10_000, 100_000, 500_000, 1_000_000, 5_000_000, 10_000_000].map(
      (c) => maxWeightBp(n, c),
    );
    for (let i = 1; i < caps.length; i++) {
      expect(caps[i]).toBeLessThanOrEqual(caps[i - 1]);
    }
  });
});

describe("audit fixes", () => {
  test("min-pool recovery: weak pool survives power-law filtering", () => {
    // Pool 0 dominates, pool 1 has very low score → power-law amplification could
    // push its weight below ALLOC_MIN_PCT. Min-pool recovery should re-include it.
    const analyses = [
      analysis(0, 0.50, 10e6),  // dominant
      analysis(1, 0.001, 1000), // extremely weak but non-zero
    ];
    const allocs = allocate(analyses, [pool(0), pool(1)], 5);
    expect(allocs.length).toBeGreaterThanOrEqual(2);
    expect(allocs.reduce((s, a) => s + a.pct, 0)).toBeCloseTo(1, 2);
  });

  test("post-filter cap enforcement: no pool exceeds cap after normalization", () => {
    // 3 pools where filtering could cause normalization to push top pool above cap
    const analyses = [
      analysis(0, 0.40, 8e6),
      analysis(1, 0.05, 500_000),
      analysis(2, 0.04, 400_000),
    ];
    const capital = 500_000;
    const allocs = allocate(analyses, [pool(0), pool(1), pool(2)], 5, capital);
    const capPct = maxWeightBp(allocs.length, capital) / 10_000;
    for (const a of allocs) {
      expect(a.pct).toBeLessThanOrEqual(capPct + 0.001);
    }
  });

  test("symmetric liquidity scoring: equal TVL pools get equal scores", () => {
    // Two pools with identical APR but different absolute TVL should still
    // get equal C-Scores if both are the max TVL in the set
    const analyses = [
      analysis(0, 0.10, 5e6),
      analysis(1, 0.10, 5e6),
    ];
    const allocs = allocate(analyses, [pool(0), pool(1)], 5);
    expect(allocs.length).toBe(2);
    expect(Math.abs(allocs[0].pct - allocs[1].pct)).toBeLessThan(0.01);
  });

  test("liquidity scoring: no pool-count bias", () => {
    // With old `tvl/totalTvl * 2`, adding more equal-weight pools would
    // change the liquidity score. With `tvl/maxTvl`, the top pool always scores BPS.
    const a2 = [analysis(0, 0.10, 5e6), analysis(1, 0.10, 5e6)];
    const a5 = [
      analysis(0, 0.10, 5e6), analysis(1, 0.10, 5e6),
      analysis(2, 0.10, 5e6), analysis(3, 0.10, 5e6), analysis(4, 0.10, 5e6),
    ];
    const allocs2 = allocate(a2, pools, 5);
    const allocs5 = allocate(a5, pools, 5);
    // Equal pools should still get equal weights regardless of pool count
    expect(Math.abs(allocs2[0].pct - allocs2[1].pct)).toBeLessThan(0.01);
    for (let i = 1; i < allocs5.length; i++) {
      expect(Math.abs(allocs5[0].pct - allocs5[i].pct)).toBeLessThan(0.01);
    }
  });
});

describe("diluted APR (Fix 4)", () => {
  test("diluted APR < raw APR when capital is material", () => {
    const analyses = [analysis(0, 0.20, 1e6), analysis(1, 0.15, 2e6)];
    const allocs = allocate(analyses, [pool(0), pool(1)], 3, 500_000);
    for (const a of allocs) {
      const raw = analyses.find((an) => an.pool === a.pool)!.apr;
      expect(a.expectedApr).toBeLessThan(raw);
    }
  });

  test("single pool dilution formula: apr × tvl / (tvl + pct × capital)", () => {
    const allocs = allocate([analysis(0, 0.20, 1e6)], [pool(0)], 1, 1e6);
    expect(allocs).toHaveLength(1);
    // Single pool gets pct=1.0, so diluted = 0.20 * 1e6 / (1e6 + 1.0 * 1e6) = 0.10
    expect(allocs[0].expectedApr).toBeCloseTo(0.10, 3);
  });

  test("no dilution when totalCapitalUsd is undefined", () => {
    const allocs = allocate([analysis(0, 0.15, 1e6)], [pool(0)], 1);
    expect(allocs[0].expectedApr).toBe(0.15);
  });

  test("no dilution when totalCapitalUsd is 0", () => {
    const allocs = allocate([analysis(0, 0.15, 1e6)], [pool(0)], 1, 0);
    expect(allocs[0].expectedApr).toBe(0.15);
  });

  test("tvl=0 pool keeps raw APR (no division by zero)", () => {
    const analyses = [analysis(0, 0.10, 0), analysis(1, 0.20, 5e6)];
    const allocs = allocate(analyses, [pool(0), pool(1)], 3, 100_000);
    const zeroTvl = allocs.find((a) => a.pool === pool(0).address);
    // tvl=0 guard: dilution skipped, expectedApr stays as raw
    if (zeroTvl) expect(zeroTvl.expectedApr).toBe(0.10);
  });

  test("large capital dominates small TVL", () => {
    // $10M capital into a $10k TVL pool → extreme dilution
    const allocs = allocate([analysis(0, 0.50, 10_000)], [pool(0)], 1, 10_000_000);
    expect(allocs[0].expectedApr).toBeLessThan(0.01);
  });

  test("weightedApr on diluted allocations is below raw average", () => {
    const analyses = [analysis(0, 0.20, 1e6), analysis(1, 0.15, 2e6)];
    const rawWeightedAvg = 0.20 * 0.5 + 0.15 * 0.5; // rough equal-weight average
    const allocs = allocate(analyses, [pool(0), pool(1)], 3, 500_000);
    expect(weightedApr(allocs)).toBeLessThan(rawWeightedAvg);
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
