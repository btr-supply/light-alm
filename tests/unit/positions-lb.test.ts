import { describe, expect, test } from "bun:test";
import { priceToBinId, buildDistributions } from "../../src/execution/positions-lb";
import { LB_BIN_ID_OFFSET, E18 } from "../../src/config/params";

// ---- priceToBinId ----

describe("priceToBinId", () => {
  test("price 1.0 at any binStep returns offset (2^23)", () => {
    // log(1.0) = 0, so binId = round(0) + 2^23 = 8388608
    expect(priceToBinId(1.0, 10)).toBe(LB_BIN_ID_OFFSET);
    expect(priceToBinId(1.0, 25)).toBe(LB_BIN_ID_OFFSET);
    expect(priceToBinId(1.0, 100)).toBe(LB_BIN_ID_OFFSET);
  });

  test("price > 1.0 returns binId > offset", () => {
    expect(priceToBinId(1.01, 10)).toBeGreaterThan(LB_BIN_ID_OFFSET);
  });

  test("price < 1.0 returns binId < offset", () => {
    expect(priceToBinId(0.99, 10)).toBeLessThan(LB_BIN_ID_OFFSET);
  });

  test("monotonically increasing with price", () => {
    const prices = [0.95, 0.99, 1.0, 1.01, 1.05];
    const binIds = prices.map((p) => priceToBinId(p, 25));
    for (let i = 1; i < binIds.length; i++) {
      expect(binIds[i]).toBeGreaterThanOrEqual(binIds[i - 1]);
    }
  });

  test("smaller binStep produces more granular bins", () => {
    // Same price ratio should span more bins with smaller binStep
    const narrow = priceToBinId(1.1, 1) - priceToBinId(0.9, 1);
    const wide = priceToBinId(1.1, 100) - priceToBinId(0.9, 100);
    expect(narrow).toBeGreaterThan(wide);
  });

  test("known binStep=10 reference", () => {
    // binStep=10 means each bin represents (1 + 10/10000) = 1.001 price ratio
    // For price 1.001: binId ≈ round(log(1.001)/log(1.001)) + offset = 1 + offset
    const id = priceToBinId(1.001, 10);
    expect(id).toBe(LB_BIN_ID_OFFSET + 1);
  });
});

// ---- buildDistributions ----

describe("buildDistributions", () => {
  test("single bin at active (deltaId=0): both X and Y get full share", () => {
    const { distributionX, distributionY } = buildDistributions([0n]);
    expect(distributionX.length).toBe(1);
    expect(distributionY.length).toBe(1);
    expect(distributionX[0]).toBe(E18);
    expect(distributionY[0]).toBe(E18);
  });

  test("symmetric range: X sum == 1e18 and Y sum == 1e18", () => {
    const deltaIds = [-2n, -1n, 0n, 1n, 2n];
    const { distributionX, distributionY } = buildDistributions(deltaIds);
    const xSum = distributionX.reduce((a, b) => a + b, 0n);
    const ySum = distributionY.reduce((a, b) => a + b, 0n);
    expect(xSum).toBe(E18);
    expect(ySum).toBe(E18);
  });

  test("X distribution: only active (>=0) bins get share", () => {
    const deltaIds = [-2n, -1n, 0n, 1n, 2n];
    const { distributionX } = buildDistributions(deltaIds);
    // deltaIds[0]=-2 and [1]=-1 should have 0 X
    expect(distributionX[0]).toBe(0n);
    expect(distributionX[1]).toBe(0n);
    // deltaIds[2]=0, [3]=1, [4]=2 should have share
    expect(distributionX[2]).toBeGreaterThan(0n);
    expect(distributionX[3]).toBeGreaterThan(0n);
    expect(distributionX[4]).toBeGreaterThan(0n);
  });

  test("Y distribution: only active (<=0) bins get share", () => {
    const deltaIds = [-2n, -1n, 0n, 1n, 2n];
    const { distributionY } = buildDistributions(deltaIds);
    // deltaIds[0]=-2, [1]=-1, [2]=0 should have share
    expect(distributionY[0]).toBeGreaterThan(0n);
    expect(distributionY[1]).toBeGreaterThan(0n);
    expect(distributionY[2]).toBeGreaterThan(0n);
    // deltaIds[3]=1, [4]=2 should have 0 Y
    expect(distributionY[3]).toBe(0n);
    expect(distributionY[4]).toBe(0n);
  });

  test("rounding fix: sum always exactly 1e18 for odd division", () => {
    // 3 X bins: 1e18/3 = 333...333 with remainder 1
    const deltaIds = [-1n, 0n, 1n, 2n]; // 3 X bins (0,1,2), 2 Y bins (-1,0)
    const { distributionX, distributionY } = buildDistributions(deltaIds);
    expect(distributionX.reduce((a, b) => a + b, 0n)).toBe(E18);
    expect(distributionY.reduce((a, b) => a + b, 0n)).toBe(E18);
  });

  test("all above active: no Y distribution", () => {
    const deltaIds = [1n, 2n, 3n];
    const { distributionX, distributionY } = buildDistributions(deltaIds);
    expect(distributionX.reduce((a, b) => a + b, 0n)).toBe(E18);
    // yCount=0, all Y shares are 0
    expect(distributionY.every((v) => v === 0n)).toBe(true);
  });

  test("all below active: no X distribution", () => {
    const deltaIds = [-3n, -2n, -1n];
    const { distributionX, distributionY } = buildDistributions(deltaIds);
    expect(distributionX.every((v) => v === 0n)).toBe(true);
    expect(distributionY.reduce((a, b) => a + b, 0n)).toBe(E18);
  });

  test("large number of bins still sums to 1e18", () => {
    const deltaIds = Array.from({ length: 51 }, (_, i) => BigInt(i - 25)); // -25..25
    const { distributionX, distributionY } = buildDistributions(deltaIds);
    expect(distributionX.reduce((a, b) => a + b, 0n)).toBe(E18);
    expect(distributionY.reduce((a, b) => a + b, 0n)).toBe(E18);
  });
});
