import { describe, expect, test, beforeEach } from "bun:test";
import { parkinsonVolatility, parkinsonVforce } from "../../src/strategy/indicators";
import {
  nelderMead,
  fitness,
  optimize,
  detectRegime,
  checkKillSwitches,
  defaultRangeParams,
  rangeParamsToVec,
  vecToRangeParams,
  resetOptimizer,
  type FitnessContext,
  type KillSwitchState,
} from "../../src/strategy/optimizer";
import type { Candle } from "../../src/types";
import { synthRandomWalk, synthM15 } from "../helpers";

// ---- Helpers ----

/** Generate M15 candles via random-walk M1 aggregation. */
function genM15(n: number, base = 1.0, vol = 0.005): Candle[] {
  return synthM15(synthRandomWalk(n * 15, base, vol));
}

function baseFitnessCtx(candles?: Candle[]): FitnessContext {
  return {
    candles: candles ?? genM15(200),
    baseApr: 0.15,
    poolFee: 0.0005,
    gasCostUsd: 0.5,
    positionValueUsd: 10_000,
  };
}

// ---- Parkinson Volatility ----

describe("parkinsonVolatility", () => {
  test("flat candles = ~0 vol", () => {
    const candles: Candle[] = Array.from({ length: 30 }, (_, i) => ({
      ts: i * 60_000,
      o: 1.0,
      h: 1.0001,
      l: 0.9999,
      c: 1.0,
      v: 100,
    }));
    expect(parkinsonVolatility(candles, 30)).toBeLessThan(0.001);
  });

  test("volatile candles = higher vol", () => {
    const candles: Candle[] = Array.from({ length: 30 }, (_, i) => ({
      ts: i * 60_000,
      o: 1.0,
      h: 1.05,
      l: 0.95,
      c: 1.0,
      v: 100,
    }));
    expect(parkinsonVolatility(candles, 30)).toBeGreaterThan(0.02);
  });

  test("insufficient data returns 0", () => {
    expect(parkinsonVolatility([], 10)).toBe(0);
    expect(parkinsonVolatility([{ ts: 0, o: 1, h: 1, l: 1, c: 1, v: 0 }], 10)).toBe(0);
  });
});

describe("parkinsonVforce", () => {
  test("maps to 0-100 scale", () => {
    const flat: Candle[] = Array.from({ length: 30 }, (_, i) => ({
      ts: i * 60_000,
      o: 1.0,
      h: 1.0001,
      l: 0.9999,
      c: 1.0,
      v: 100,
    }));
    const f = parkinsonVforce(flat, 30);
    expect(f).toBeGreaterThanOrEqual(0);
    expect(f).toBeLessThanOrEqual(100);
    expect(f).toBeLessThan(10); // should be very low
  });

  test("high vol maps to high force", () => {
    const wild: Candle[] = Array.from({ length: 30 }, (_, i) => ({
      ts: i * 60_000,
      o: 1.0,
      h: 1.1,
      l: 0.9,
      c: 1.0,
      v: 100,
    }));
    expect(parkinsonVforce(wild, 30)).toBeGreaterThan(50);
  });
});

// ---- Nelder-Mead ----

describe("nelderMead", () => {
  test("optimizes a simple quadratic", () => {
    // Maximize -(x-target)^2 for each dim, peak within bounds
    const evalFn = (x: number[]) => {
      const d0 = x[0] - 0.002;
      const d1 = x[1] - 0.03;
      const d2 = x[2] + 0.3;
      const d3 = x[3] - 200;
      const d4 = x[4] - 0.2;
      return -(d0 * d0 + d1 * d1 + d2 * d2 + d3 * d3 + d4 * d4);
    };
    const result = nelderMead(evalFn, [0.001, 0.02, -0.5, 300, 0.25]);
    expect(result.fitness).toBeGreaterThan(-1);
    expect(result.evals).toBeGreaterThan(5);
    expect(result.evals).toBeLessThanOrEqual(306); // DIM+1 + MAX_EVALS
  });

  test("converges on trivial constant function", () => {
    const result = nelderMead(() => 42, [0.001, 0.02, -0.5, 300, 0.25]);
    expect(result.fitness).toBe(42);
  });
});

// ---- Fitness function ----

describe("fitness", () => {
  test("returns finite value for valid inputs", () => {
    const ctx = baseFitnessCtx();
    const vec = rangeParamsToVec(defaultRangeParams());
    const f = fitness(vec, ctx);
    expect(Number.isFinite(f)).toBe(true);
  });

  test("returns -Infinity for insufficient candles", () => {
    const ctx = baseFitnessCtx(genM15(5));
    const vec = rangeParamsToVec(defaultRangeParams());
    expect(fitness(vec, ctx)).toBe(-Infinity);
  });

  test("narrower ranges produce more rebalancing cost", () => {
    const ctx = baseFitnessCtx(genM15(300, 1.0, 0.01));
    const narrow = [0.0001, 0.005, -0.1, 50, 0.15]; // very narrow
    const wide = [0.003, 0.08, -0.8, 800, 0.3]; // very wide
    const fNarrow = fitness(narrow, ctx);
    const fWide = fitness(wide, ctx);
    expect(Number.isFinite(fNarrow)).toBe(true);
    expect(Number.isFinite(fWide)).toBe(true);
    expect(fWide).not.toBe(fNarrow);
    expect(fWide).toBeGreaterThan(fNarrow);
  });

  test("LVR is discrete: only incurred at rebalance events, not continuously", () => {
    // Stable prices produce finite fitness; LVR term is 0 (no price movement between RS events)
    const stableCandles: Candle[] = Array.from({ length: 100 }, (_, i) => ({
      ts: i * 900_000,
      o: 1.0,
      h: 1.001,
      l: 0.999,
      c: 1.0,
      v: 1000,
    }));
    const ctx = baseFitnessCtx(stableCandles);
    // High vforceDivider + wide range = fewer RS events, but initVf=50 still triggers
    // initial range calibration RS. The key property: LVR fraction is 0 since price is flat.
    const wideVec = [0.003, 0.08, -0.8, 800, 0.35];
    const f = fitness(wideVec, ctx);
    expect(Number.isFinite(f)).toBe(true);
    // Volatile candles should produce worse fitness due to LVR at RS events
    const volatileCandles: Candle[] = Array.from({ length: 100 }, (_, i) => {
      const p = 1.0 + 0.05 * Math.sin(i / 5);
      return { ts: i * 900_000, o: p, h: p * 1.02, l: p * 0.98, c: p, v: 1000 };
    });
    const ctxVol = { ...ctx, candles: volatileCandles };
    const fVol = fitness(wideVec, ctxVol);
    expect(Number.isFinite(fVol)).toBe(true);
    // Stable candles should produce better or equal fitness (less LVR crystallized)
    expect(f).toBeGreaterThanOrEqual(fVol);
  });

  test("trending prices trigger RS and incur LVR", () => {
    // Strong uptrend: price goes from 1.0 to 1.5
    const trendCandles: Candle[] = Array.from({ length: 100 }, (_, i) => {
      const p = 1.0 + i * 0.005;
      return { ts: i * 900_000, o: p, h: p * 1.01, l: p * 0.99, c: p, v: 1000 };
    });
    const ctx = baseFitnessCtx(trendCandles);
    // Narrow range + low RS threshold = frequent rebalancing = more LVR
    const narrowVec = [0.001, 0.01, -0.2, 100, 0.1];
    const wideVec = [0.003, 0.08, -0.8, 500, 0.35];
    const fNarrow = fitness(narrowVec, ctx);
    const fWide = fitness(wideVec, ctx);
    // Wide range in trending market should have less LVR penalty
    // (fewer RS events = fewer crystallized IL moments)
    expect(Number.isFinite(fNarrow)).toBe(true);
    expect(Number.isFinite(fWide)).toBe(true);
    expect(fWide).toBeGreaterThanOrEqual(fNarrow);
  });
});

// ---- Optimizer integration ----

describe("optimize", () => {
  beforeEach(() => resetOptimizer("test"));

  test("returns valid params and positive fitness", () => {
    const ctx = baseFitnessCtx(genM15(200));
    const result = optimize(ctx, "test");
    expect(result.params.baseMin).toBeGreaterThanOrEqual(0.0001);
    expect(result.params.baseMax).toBeLessThanOrEqual(0.1);
    expect(result.params.rsThreshold).toBeGreaterThanOrEqual(0.1);
    expect(result.params.rsThreshold).toBeLessThanOrEqual(0.35);
    expect(result.evals).toBeGreaterThan(0);
  });

  test("falls back to defaults when optimizer underperforms", () => {
    // Tiny candle set makes optimizer struggle
    const ctx = baseFitnessCtx(genM15(25));
    const result = optimize(ctx, "test");
    // Should either match defaults or be valid
    expect(result.params.rsThreshold).toBeGreaterThanOrEqual(0.1);
    expect(Number.isFinite(result.fitness)).toBe(true);
  });

  test("warm-starts from previous solution", () => {
    const ctx = baseFitnessCtx(genM15(200));
    const r1 = optimize(ctx, "test");
    const r2 = optimize(ctx, "test"); // should warm-start
    // Both should produce valid results
    expect(Number.isFinite(r1.fitness)).toBe(true);
    expect(Number.isFinite(r2.fitness)).toBe(true);
  });
});

// ---- Regime detection ----

describe("detectRegime", () => {
  test("normal conditions = not suppressed", () => {
    const candles = synthRandomWalk(2000, 1.0, 0.001);
    const r = detectRegime(candles, 10, false);
    expect(r.suppressed).toBe(false);
    expect(r.widenFactor).toBe(1.0);
  });

  test("insufficient data = not suppressed", () => {
    const r = detectRegime(synthRandomWalk(30), 1, false);
    expect(r.suppressed).toBe(false);
  });

  test("price displacement triggers suppression for stables", () => {
    // Create candles with uniform low vol but a sudden price shift in the last minute
    // This avoids triggering vol_spike (H-L stays narrow, consistent)
    const candles: Candle[] = Array.from({ length: 2000 }, (_, i) => ({
      ts: i * 60_000,
      o: 1.0,
      h: 1.0002,
      l: 0.9998,
      c: 1.0,
      v: 100,
    }));
    // Shift close price in last candle by 3% (above 2% stable threshold)
    candles[candles.length - 1].c = 1.03;
    const r = detectRegime(candles, 10, true); // isStable = true, threshold 2%
    expect(r.suppressed).toBe(true);
    expect(r.reason).toBe("price_displacement");
  });
});

// ---- Kill switches ----

describe("checkKillSwitches", () => {
  test("normal state = no defaults", () => {
    const ks: KillSwitchState = {
      trailingYields: Array(24).fill(0.01),
      rsTimestamps: [],
      trailing24hGasUsd: 0,
    };
    const r = checkKillSwitches(ks, 10_000, defaultRangeParams());
    expect(r.useDefaults).toBe(false);
  });

  test("negative trailing yield triggers defaults", () => {
    const ks: KillSwitchState = {
      trailingYields: Array(24).fill(-0.01),
      rsTimestamps: [],
      trailing24hGasUsd: 0,
    };
    const r = checkKillSwitches(ks, 10_000, defaultRangeParams());
    expect(r.useDefaults).toBe(true);
    expect(r.reason).toBe("negative_trailing_yield");
  });

  test("excessive RS triggers defaults", () => {
    const now = Date.now();
    const ks: KillSwitchState = {
      trailingYields: Array(24).fill(0.01),
      rsTimestamps: Array(9).fill(now - 1000), // 9 RS in last second
      trailing24hGasUsd: 0,
    };
    const r = checkKillSwitches(ks, 10_000, defaultRangeParams());
    expect(r.useDefaults).toBe(true);
    expect(r.reason).toBe("excessive_rs");
  });

  test("gas budget exceeded triggers defaults", () => {
    const ks: KillSwitchState = {
      trailingYields: Array(24).fill(0.01),
      rsTimestamps: [],
      trailing24hGasUsd: 600,
    };
    const r = checkKillSwitches(ks, 10_000, defaultRangeParams());
    expect(r.useDefaults).toBe(true);
    expect(r.reason).toBe("gas_budget_exceeded");
  });
});

// ---- Vec conversion round-trip ----

describe("rangeParams conversion", () => {
  test("round-trips correctly", () => {
    const p = defaultRangeParams();
    const v = rangeParamsToVec(p);
    const p2 = vecToRangeParams(v);
    expect(p2.baseMin).toBe(p.baseMin);
    expect(p2.baseMax).toBe(p.baseMax);
    expect(p2.vforceExp).toBe(p.vforceExp);
    expect(p2.vforceDivider).toBe(p.vforceDivider);
    expect(p2.rsThreshold).toBe(p.rsThreshold);
  });
});
