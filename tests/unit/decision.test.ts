import { describe, expect, test } from "bun:test";
import { decide, buildPairAllocation } from "../../src/strategy/decision";
import type { AllocationEntry, Position } from "../../src/types";
import { neutralForces } from "../helpers";

function alloc(i: number, apr: number, pct: number): AllocationEntry {
  return {
    pool: `0x${i.toString().padStart(40, "0")}` as `0x${string}`,
    chain: 1,
    dex: "uniswap_v3",
    pct,
    expectedApr: apr,
  };
}

function position(i: number, apr: number, valueUsd = 1000): Position {
  // Ticks [-280, 280] ≈ range [0.9724, 1.0284], matching neutral forces + default baseRange params
  return {
    id: `1:0x${i}:${Date.now()}`,
    pool: `0x${i.toString().padStart(40, "0")}` as `0x${string}`,
    chain: 1,
    dex: "uniswap_v3",
    positionId: "12345",
    tickLower: -280,
    tickUpper: 280,
    liquidity: 1000000n,
    amount0: 500000n,
    amount1: 500000n,
    entryPrice: 1.0,
    entryTs: Date.now(),
    entryApr: apr,
    entryValueUsd: valueUsd,
  };
}

describe("decide", () => {
  test("HOLD when no improvement", () => {
    const allocations = [alloc(1, 0.1, 1)];
    const positions = [position(1, 0.1)];
    const d = decide(allocations, positions, neutralForces(5), 1.0, { pra: 0.05, rs: 0.25 });
    expect(d.type).toBe("HOLD");
  });

  test("PRA when improvement exceeds threshold", () => {
    const allocations = [alloc(1, 0.2, 1)];
    const positions = [position(1, 0.1)];
    const d = decide(allocations, positions, neutralForces(5), 1.0, { pra: 0.05, rs: 0.25 });
    expect(d.type).toBe("PRA");
    expect(d.improvement).toBeGreaterThan(0.05);
  });

  test("PRA when no existing positions and positive optimal", () => {
    const allocations = [alloc(1, 0.15, 1)];
    const d = decide(allocations, [], neutralForces(5), 1.0, { pra: 0.05, rs: 0.25 });
    expect(d.type).toBe("PRA");
    expect(d.improvement).toBe(1); // 100% improvement from 0
  });

  test("HOLD when no target allocations", () => {
    const d = decide([], [], neutralForces(5), 1.0, { pra: 0.05, rs: 0.25 });
    expect(d.type).toBe("HOLD");
  });

  test("RS when range diverges beyond threshold", () => {
    const allocations = [alloc(1, 0.1, 1)];
    // Position with very narrow range — only [-10, 10] ticks
    // Neutral target range is ~[-172, 172], so divergence is huge (~0.94)
    const pos = position(1, 0.1);
    pos.tickLower = -10;
    pos.tickUpper = 10;
    const d = decide(allocations, [pos], neutralForces(5), 1.0, { pra: 0.05, rs: 0.25 });
    expect(d.type).toBe("RS");
    expect(d.rangeShifts).toBeDefined();
    expect(d.rangeShifts!.length).toBe(1);
    expect(d.rangeShifts![0].pool).toBe(pos.pool);
  });

  test("HOLD when last rebalance within MIN_HOLD_MS", () => {
    const allocations = [alloc(1, 0.5, 1)]; // huge optimal APR
    const positions = [position(1, 0.05)]; // low current APR
    // lastRebalTs = 1h ago, MIN_HOLD_MS = 12h — should force HOLD
    const d = decide(
      allocations,
      positions,
      neutralForces(5),
      1.0,
      { pra: 0.05, rs: 0.25 },
      Date.now() - 3600_000,
    );
    expect(d.type).toBe("HOLD");
    // Without min hold, improvement would be (0.50-0.05)/0.05 = 9.0 >> 0.05 threshold
    expect(d.improvement).toBeGreaterThan(0.05);
  });

  test("PRA after MIN_HOLD_MS elapsed", () => {
    const allocations = [alloc(1, 0.5, 1)];
    const positions = [position(1, 0.05)];
    // lastRebalTs = 13h ago, MIN_HOLD_MS = 12h — should allow PRA
    const d = decide(
      allocations,
      positions,
      neutralForces(5),
      1.0,
      { pra: 0.05, rs: 0.25 },
      Date.now() - 13 * 3600_000,
    );
    expect(d.type).toBe("PRA");
  });

  test("M14: value-weighted currentApr", () => {
    const allocations = [alloc(1, 0.15, 0.5), alloc(2, 0.15, 0.5)];
    const positions = [
      position(1, 0.05, 100000), // $100k at 5%
      position(2, 0.5, 1000), // $1k at 50%
    ];
    const d = decide(allocations, positions, neutralForces(5), 1.0, { pra: 0.05, rs: 0.25 });
    // Value-weighted: (0.05 * 100000 + 0.50 * 1000) / 101000 ≈ 0.0544
    // Simple average would be 0.275
    expect(d.currentApr).toBeLessThan(0.1);
    expect(d.currentApr).toBeGreaterThan(0.04);
  });
});

describe("buildPairAllocation", () => {
  test("builds allocation from decision", () => {
    const allocations = [alloc(1, 0.15, 1)];
    const positions = [position(1, 0.1)];
    const decision = decide(allocations, positions, neutralForces(5), 1.0, { pra: 0.05, rs: 0.25 });
    const pa = buildPairAllocation(decision, positions);
    expect(pa.decision).toBe(decision.type);
    expect(pa.currentAllocations).toHaveLength(1);
    expect(pa.targetAllocations).toEqual(decision.targetAllocations);
  });

  test("empty positions = empty current allocations", () => {
    const decision = decide([], [], neutralForces(5), 1.0, { pra: 0.05, rs: 0.25 });
    const pa = buildPairAllocation(decision, []);
    expect(pa.currentAllocations).toHaveLength(0);
  });
});
