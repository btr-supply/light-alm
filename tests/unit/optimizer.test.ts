import { describe, expect, test, beforeEach } from "bun:test";
import { parkinsonVolatility, parkinsonVforce } from "../../src/strategy/forces";
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
import {
  NM_MAX_EVALS,
  REGIME_DISPLACEMENT_STABLE,
  REGIME_DISPLACEMENT_VOLATILE,
  REGIME_SUPPRESS_CYCLES,
  REGIME_VOL_WINDOW,
  REGIME_WIDEN_FACTOR,
  DEFAULT_CAPITAL_USD,
} from "../../src/config/params";
import type { Candle } from "../../src/types";
import { synthRandomWalk, synthM15, synthFlat } from "../helpers";

// ---- Helpers ----

const SEED = 42;

/** Generate deterministic M15 candles via seeded random-walk M1 aggregation. */
function genM15(n: number, base = 1.0, vol = 0.005, seed = SEED): Candle[] {
  return synthM15(synthRandomWalk(n * 15, base, vol, seed));
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
  });

  test("converges on trivial constant function", () => {
    const result = nelderMead(() => 42, [0.001, 0.02, -0.5, 300, 0.25]);
    expect(result.fitness).toBe(42);
  });
});

// ---- Fitness function ----

describe("fitness", () => {
  test("returns -Infinity for insufficient candles", () => {
    const ctx = baseFitnessCtx(genM15(5));
    const vec = rangeParamsToVec(defaultRangeParams());
    expect(fitness(vec, ctx)).toBe(-Infinity);
  });

  test("wider ranges outperform narrow in volatile trending markets", () => {
    // Deterministic seeded random walk with higher vol
    const ctx = baseFitnessCtx(genM15(300, 1.0, 0.01, SEED));
    const narrow = [0.0001, 0.005, -0.1, 50, 0.15]; // very narrow range, low RS threshold
    const wide = [0.003, 0.08, -0.8, 800, 0.3]; // very wide range, high RS threshold
    const fNarrow = fitness(narrow, ctx);
    const fWide = fitness(wide, ctx);
    expect(fWide).toBeGreaterThan(fNarrow);
  });

  test("continuous LVR: stable prices produce higher fitness than volatile", () => {
    const stableCandles: Candle[] = Array.from({ length: 100 }, (_, i) => ({
      ts: i * 900_000,
      o: 1.0,
      h: 1.001,
      l: 0.999,
      c: 1.0,
      v: 1000,
    }));
    const ctx = baseFitnessCtx(stableCandles);
    const wideVec = [0.003, 0.08, -0.8, 800, 0.35];
    const fStable = fitness(wideVec, ctx);

    // Volatile candles incur higher continuous LVR
    const volatileCandles: Candle[] = Array.from({ length: 100 }, (_, i) => {
      const p = 1.0 + 0.05 * Math.sin(i / 5);
      return { ts: i * 900_000, o: p, h: p * 1.02, l: p * 0.98, c: p, v: 1000 };
    });
    const fVol = fitness(wideVec, { ...ctx, candles: volatileCandles });
    expect(fStable).toBeGreaterThanOrEqual(fVol);
  });

  test("trending prices trigger RS and incur LVR", () => {
    // Strong uptrend: price goes from 1.0 to 1.5
    const trendCandles: Candle[] = Array.from({ length: 100 }, (_, i) => {
      const p = 1.0 + i * 0.005;
      return { ts: i * 900_000, o: p, h: p * 1.01, l: p * 0.99, c: p, v: 1000 };
    });
    const ctx = baseFitnessCtx(trendCandles);
    const narrowVec = [0.001, 0.01, -0.2, 100, 0.1];
    const wideVec = [0.003, 0.08, -0.8, 500, 0.35];
    const fNarrow = fitness(narrowVec, ctx);
    const fWide = fitness(wideVec, ctx);
    expect(fWide).toBeGreaterThanOrEqual(fNarrow);
  });

  test("higher H-L spread increases LVR drag on fitness", () => {
    // Same close prices, but different H-L spreads (Parkinson sigma source)
    const makeCandles = (spread: number): Candle[] =>
      Array.from({ length: 100 }, (_, i) => ({
        ts: i * 900_000,
        o: 1.0,
        h: 1.0 + spread,
        l: 1.0 - spread,
        c: 1.0,
        v: 1000,
      }));
    const ctx = baseFitnessCtx();
    const wideVec = [0.003, 0.08, -0.8, 800, 0.35];
    const fLowVol = fitness(wideVec, { ...ctx, candles: makeCandles(0.001) });
    const fHighVol = fitness(wideVec, { ...ctx, candles: makeCandles(0.02) });
    // Higher vol → higher annualized LVR → lower fitness
    expect(fLowVol).toBeGreaterThan(fHighVol);
  });

  test("fee concentration rewards narrow ranges on flat prices", () => {
    // Flat candles: no LVR, no RS triggers. Only fees matter.
    const m15 = synthM15(Array.from({ length: 100 * 15 }, (_, i) => ({
      ts: Date.now() - (100 * 15 - i) * 60_000,
      o: 1.0, h: 1.00005, l: 0.99995, c: 1.0, v: 1000,
    })));
    const ctx: FitnessContext = {
      candles: m15,
      baseApr: 0.20,
      poolFee: 0.003, // 30bp pool fee → refHalfW = 0.3
      gasCostUsd: 0.01,
      positionValueUsd: 10_000,
    };
    // Narrow position earns higher concentration multiplier on flat prices
    const narrowVec = [0.0001, 0.005, -0.05, 50, 0.35]; // very narrow
    const wideVec = [0.005, 0.1, -1.0, 1000, 0.35]; // very wide
    const fNarrow = fitness(narrowVec, ctx);
    const fWide = fitness(wideVec, ctx);
    expect(fNarrow).toBeGreaterThan(fWide);
  });

  test("rejects lucky validation: negative training + positive validation", () => {
    // Training window (80%): wild oscillations with huge H-L → massive continuous LVR
    // Validation window (20%): perfectly flat → fees only, positive fitness
    const candles: Candle[] = [];
    for (let i = 0; i < 80; i++) {
      const p = 1.0 + 0.3 * Math.sin(i / 3); // wild oscillation ±30%
      candles.push({ ts: i * 900_000, o: p, h: p * 1.10, l: p * 0.90, c: p, v: 1000 });
    }
    for (let i = 80; i < 100; i++) {
      candles.push({ ts: i * 900_000, o: 1.0, h: 1.0001, l: 0.9999, c: 1.0, v: 1000 });
    }
    const ctx: FitnessContext = {
      candles,
      baseApr: 0.10, // moderate APR: positive in flat, negative in wild vol
      poolFee: 0.0005,
      gasCostUsd: 0.5,
      positionValueUsd: 10_000,
    };
    // Wide range + high RS threshold to minimize RS events (isolate continuous LVR effect)
    const vec = [0.003, 0.08, -0.8, 800, 0.35];
    expect(fitness(vec, ctx)).toBe(-Infinity);
  });

  test("positionValueUsd=0 falls back to DEFAULT_CAPITAL_USD", () => {
    const candles = genM15(200, 1.0, 0.005, 99);
    const vec = rangeParamsToVec(defaultRangeParams());
    const fZero = fitness(vec, { ...baseFitnessCtx(candles), positionValueUsd: 0 });
    const fDefault = fitness(vec, { ...baseFitnessCtx(candles), positionValueUsd: DEFAULT_CAPITAL_USD });
    // Both should use DEFAULT_CAPITAL_USD=10000, so fitness is identical
    expect(fZero).toBe(fDefault);
    // And must not be -Infinity (the fallback produces real costs)
    expect(fZero).not.toBe(-Infinity);
  });
});

// ---- Optimizer integration ----

describe("optimize", () => {
  beforeEach(() => resetOptimizer("test"));

  test("returns params within OPT_BOUNDS", () => {
    const ctx = baseFitnessCtx(genM15(200, 1.0, 0.005, 77));
    const result = optimize(ctx, "test");
    expect(result.params.baseMin).toBeGreaterThanOrEqual(0.0001);
    expect(result.params.baseMax).toBeLessThanOrEqual(0.1);
    expect(result.params.rsThreshold).toBeGreaterThanOrEqual(0.1);
    expect(result.params.rsThreshold).toBeLessThanOrEqual(0.35);
    expect(result.evals).toBeGreaterThan(0);
  });

  test("falls back to defaults when optimizer underperforms", () => {
    const ctx = baseFitnessCtx(genM15(25, 1.0, 0.005, 88));
    const result = optimize(ctx, "test");
    expect(result.params.rsThreshold).toBeGreaterThanOrEqual(0.1);
  });

  test("warm-starts from previous solution", () => {
    const ctx = baseFitnessCtx(genM15(200, 1.0, 0.005, 55));
    const r1 = optimize(ctx, "test");
    const r2 = optimize(ctx, "test"); // warm-start from r1
    // Warm-start should produce equal or better fitness
    expect(r2.fitness).toBeGreaterThanOrEqual(r1.fitness);
  });

  test("multi-restart evaluates more than a single NM initialization", () => {
    const ctx = baseFitnessCtx(genM15(200, 1.0, 0.005, 33));
    const result = optimize(ctx, "test");
    // NM_RESTARTS=3, each start initializes a DIM+1=6 simplex → minimum 18 evals
    // Plus default evaluation → 19 minimum. Each run then iterates further.
    const DIM = 5;
    expect(result.evals).toBeGreaterThanOrEqual(3 * (DIM + 1));
  });
});

// ---- Regime detection ----

describe("detectRegime", () => {
  test("normal conditions = not suppressed", () => {
    // Deterministic: low-vol flat candles with enough history
    const candles: Candle[] = Array.from({ length: 2000 }, (_, i) => ({
      ts: i * 60_000,
      o: 1.0,
      h: 1.0003,
      l: 0.9997,
      c: 1.0,
      v: 100,
    }));
    const r = detectRegime(candles, 10, false);
    expect(r.suppressed).toBe(false);
    expect(r.widenFactor).toBe(1.0);
  });

  test("insufficient data = not suppressed", () => {
    const r = detectRegime(synthFlat(30), 1, false);
    expect(r.suppressed).toBe(false);
  });

  test("price displacement triggers suppression for stables (2% threshold)", () => {
    const candles: Candle[] = Array.from({ length: 2000 }, (_, i) => ({
      ts: i * 60_000,
      o: 1.0,
      h: 1.0002,
      l: 0.9998,
      c: 1.0,
      v: 100,
    }));
    // 3% shift in the last candle exceeds the 2% stable threshold
    candles[candles.length - 1].c = 1.03;
    const r = detectRegime(candles, 10, true);
    expect(r.suppressed).toBe(true);
    expect(r.reason).toBe("price_displacement");
    expect(r.suppressUntilEpoch).toBe(10 + REGIME_SUPPRESS_CYCLES);
  });

  test("volatile pair uses vol-relative displacement threshold", () => {
    // Build candles with consistent moderate H-L spread so muVol is meaningful
    // Per-bar Parkinson σ ≈ ln(h/l) / (2√ln2) ≈ ln(1.04/0.96) / 1.665 ≈ 0.0499
    // Hourly muVol ≈ 0.0499 → threshold = max(4 * 0.0499 * √60, 0.02) ≈ max(1.546, 0.02) = 1.546
    // So a 10% displacement should NOT trigger suppression
    const candles: Candle[] = Array.from({ length: 2000 }, (_, i) => ({
      ts: i * 60_000,
      o: 1.0,
      h: 1.04,
      l: 0.96,
      c: 1.0,
      v: 100,
    }));
    candles[candles.length - 1].c = 1.1; // 10% displacement
    const r = detectRegime(candles, 10, false); // isStable=false
    expect(r.suppressed).toBe(false);
  });

  test("volatile pair displacement floor at REGIME_DISPLACEMENT_MIN", () => {
    // Very low vol candles but isStable=false: threshold = max(4*~0*√60, 0.02) = 0.02
    const candles: Candle[] = Array.from({ length: 2000 }, (_, i) => ({
      ts: i * 60_000,
      o: 1.0,
      h: 1.00001,
      l: 0.99999,
      c: 1.0,
      v: 100,
    }));
    // 2.5% displacement exceeds the 2% floor
    candles[candles.length - 1].c = 1.025;
    const r = detectRegime(candles, 10, false);
    expect(r.suppressed).toBe(true);
    expect(r.reason).toBe("price_displacement");
  });

  test("volatile pair falls back to REGIME_DISPLACEMENT_VOLATILE when no vol history", () => {
    // Only 60 candles: enough for M1_PER_HOUR check, but hourlyVols.length=1 < REGIME_MIN_HOURLY_SAMPLES=10
    // So muVol stays 0, fallback threshold is REGIME_DISPLACEMENT_VOLATILE=0.10
    const candles: Candle[] = Array.from({ length: 61 }, (_, i) => ({
      ts: i * 60_000,
      o: 1.0,
      h: 1.001,
      l: 0.999,
      c: 1.0,
      v: 100,
    }));
    // 15% displacement exceeds the 10% fallback
    candles[candles.length - 1].c = 1.15;
    const r = detectRegime(candles, 10, false);
    expect(r.suppressed).toBe(true);
    expect(r.reason).toBe("price_displacement");
  });

  test("vol_spike triggers suppression when 1h vol exceeds 3σ above mean", () => {
    // 2000 candles with consistent low vol, then spike last 60 candles' H-L
    const candles: Candle[] = Array.from({ length: 2000 }, (_, i) => ({
      ts: i * 60_000,
      o: 1.0,
      h: 1.001,
      l: 0.999,
      c: 1.0,
      v: 100,
    }));
    // Spike the last 60 candles with huge H-L spread (10x normal)
    for (let i = 1940; i < 2000; i++) {
      candles[i].h = 1.1;
      candles[i].l = 0.9;
    }
    const r = detectRegime(candles, 10, false);
    expect(r.suppressed).toBe(true);
    expect(r.reason).toBe("vol_spike");
    expect(r.suppressUntilEpoch).toBe(10 + REGIME_SUPPRESS_CYCLES);
  });

  test("volume_anomaly widens range without suppressing", () => {
    // Normal candles with low vol, then spike volume in last REGIME_VOL_WINDOW
    const candles: Candle[] = Array.from({ length: 2000 }, (_, i) => ({
      ts: i * 60_000,
      o: 1.0,
      h: 1.0002,
      l: 0.9998,
      c: 1.0,
      v: 100,
    }));
    // Spike volume in last 15 candles to 6x average
    for (let i = 2000 - REGIME_VOL_WINDOW; i < 2000; i++) {
      candles[i].v = 10000;
    }
    const r = detectRegime(candles, 10, false);
    expect(r.suppressed).toBe(false);
    expect(r.reason).toBe("volume_anomaly");
    expect(r.widenFactor).toBe(REGIME_WIDEN_FACTOR);
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
