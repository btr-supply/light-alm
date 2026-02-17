import { describe, expect, test } from "bun:test";
import { tickToSqrtPriceX96, computeLiquidity } from "../../src/execution/positions-v4";
import { Q96, V4_MAX_TICK } from "../../src/config/params";

// ---- tickToSqrtPriceX96 ----

describe("tickToSqrtPriceX96", () => {
  // Reference values from Uniswap V3/V4 TickMath.getSqrtRatioAtTick

  test("tick 0 returns Q96 (1:1 price)", () => {
    // At tick 0, sqrtPrice = 1.0, so sqrtPriceX96 = 2^96
    expect(tickToSqrtPriceX96(0)).toBe(Q96);
  });

  test("positive tick returns > Q96", () => {
    const result = tickToSqrtPriceX96(100);
    expect(result).toBeGreaterThan(Q96);
  });

  test("negative tick returns < Q96", () => {
    const result = tickToSqrtPriceX96(-100);
    expect(result).toBeLessThan(Q96);
  });

  test("symmetric: tick(n) * tick(-n) ≈ Q96^2", () => {
    // sqrtPrice(tick) * sqrtPrice(-tick) should ≈ 1.0 in Q96 space
    const pos = tickToSqrtPriceX96(1000);
    const neg = tickToSqrtPriceX96(-1000);
    const product = (pos * neg) / Q96;
    // Should be close to Q96 (within rounding)
    const diff = product > Q96 ? product - Q96 : Q96 - product;
    expect(diff).toBeLessThan(Q96 / 1000n); // <0.1% error
  });

  test("tick 1 matches known reference", () => {
    // tick 1: sqrtPriceX96 = 79232123823359799118286999568
    // (from Uniswap TickMath reference)
    const result = tickToSqrtPriceX96(1);
    expect(result).toBe(79232123823359799118286999568n);
  });

  test("tick -1 matches known reference", () => {
    // tick -1: sqrtPriceX96 = 79224201403219477170569942574
    const result = tickToSqrtPriceX96(-1);
    expect(result).toBe(79224201403219477170569942574n);
  });

  test("MIN_TICK returns minimum sqrtPrice", () => {
    const result = tickToSqrtPriceX96(-V4_MAX_TICK);
    expect(result).toBeGreaterThan(0n);
    expect(result).toBeLessThan(Q96);
  });

  test("MAX_TICK returns maximum sqrtPrice", () => {
    const result = tickToSqrtPriceX96(V4_MAX_TICK);
    expect(result).toBeGreaterThan(Q96);
  });

  test("throws for tick > MAX_TICK", () => {
    expect(() => tickToSqrtPriceX96(V4_MAX_TICK + 1)).toThrow("out of range");
  });

  test("throws for tick < -MAX_TICK", () => {
    expect(() => tickToSqrtPriceX96(-V4_MAX_TICK - 1)).toThrow("out of range");
  });

  test("monotonically increasing", () => {
    const ticks = [-10000, -1000, -100, -10, 0, 10, 100, 1000, 10000];
    const prices = ticks.map(tickToSqrtPriceX96);
    for (let i = 1; i < prices.length; i++) {
      expect(prices[i]).toBeGreaterThan(prices[i - 1]);
    }
  });

  test("USDC-USDT range (tight ticks around 0)", () => {
    // For stablecoin pairs, ticks are near 0
    const lower = tickToSqrtPriceX96(-10);
    const upper = tickToSqrtPriceX96(10);
    expect(lower).toBeLessThan(Q96);
    expect(upper).toBeGreaterThan(Q96);
    // Spread should be small
    const ratio = (upper * 10000n) / lower;
    expect(ratio).toBeGreaterThan(10000n); // > 1.0
    expect(ratio).toBeLessThan(10020n); // < 1.002 (very tight)
  });
});

// ---- computeLiquidity ----

describe("computeLiquidity", () => {
  test("in range: constrained by min(L0, L1)", () => {
    const sqrtPrice = Q96; // tick 0
    const tickLower = -100;
    const tickUpper = 100;
    const amount0 = 10n ** 18n;
    const amount1 = 10n ** 18n;

    const L = computeLiquidity(sqrtPrice, tickLower, tickUpper, amount0, amount1);
    expect(L).toBeGreaterThan(0n);
  });

  test("below range: all token0", () => {
    // sqrtPrice at tick -500, range is [0, 100] — price is below range
    const sqrtPrice = tickToSqrtPriceX96(-500);
    const tickLower = 0;
    const tickUpper = 100;
    const amount0 = 10n ** 18n;
    const amount1 = 10n ** 18n;

    const L = computeLiquidity(sqrtPrice, tickLower, tickUpper, amount0, amount1);
    expect(L).toBeGreaterThan(0n);
    // Below range uses only amount0, so result should be independent of amount1
    const L2 = computeLiquidity(sqrtPrice, tickLower, tickUpper, amount0, 0n);
    expect(L2).toBe(L);
  });

  test("above range: all token1", () => {
    // sqrtPrice at tick 500, range is [-100, 0] — price is above range
    const sqrtPrice = tickToSqrtPriceX96(500);
    const tickLower = -100;
    const tickUpper = 0;
    const amount0 = 10n ** 18n;
    const amount1 = 10n ** 18n;

    const L = computeLiquidity(sqrtPrice, tickLower, tickUpper, amount0, amount1);
    expect(L).toBeGreaterThan(0n);
    // Above range uses only amount1, so result should be independent of amount0
    const L2 = computeLiquidity(sqrtPrice, tickLower, tickUpper, 0n, amount1);
    expect(L2).toBe(L);
  });

  test("zero amounts yield zero liquidity", () => {
    const sqrtPrice = Q96;
    expect(computeLiquidity(sqrtPrice, -100, 100, 0n, 0n)).toBe(0n);
  });

  test("wider range yields less liquidity for same amounts", () => {
    const sqrtPrice = Q96;
    const amount0 = 10n ** 18n;
    const amount1 = 10n ** 18n;

    const narrow = computeLiquidity(sqrtPrice, -10, 10, amount0, amount1);
    const wide = computeLiquidity(sqrtPrice, -1000, 1000, amount0, amount1);
    expect(narrow).toBeGreaterThan(wide);
  });

  test("more tokens yield more liquidity", () => {
    const sqrtPrice = Q96;
    const small = computeLiquidity(sqrtPrice, -100, 100, 10n ** 16n, 10n ** 16n);
    const large = computeLiquidity(sqrtPrice, -100, 100, 10n ** 18n, 10n ** 18n);
    expect(large).toBeGreaterThan(small);
  });
});
