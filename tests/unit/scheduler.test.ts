import { describe, expect, test, beforeAll } from "bun:test";
import { DEFAULT_FORCE_PARAMS } from "../../src/config/params";
import { mergeForceParams } from "../../src/scheduler";
import { silenceLog } from "../helpers";

// Silence log output during tests
beforeAll(silenceLog);

describe("mergeForceParams", () => {
  test("returns defaults when no partial provided", () => {
    const result = mergeForceParams();
    expect(result.volatility.lookback).toBe(DEFAULT_FORCE_PARAMS.volatility.lookback);
    expect(result.momentum.lookback).toBe(DEFAULT_FORCE_PARAMS.momentum.lookback);
    expect(result.trend.lookback).toBe(DEFAULT_FORCE_PARAMS.trend.lookback);
    expect(result.rsThreshold).toBe(DEFAULT_FORCE_PARAMS.rsThreshold);
    expect(result.baseRange.min).toBe(DEFAULT_FORCE_PARAMS.baseRange.min);
  });

  test("returns defaults when undefined provided", () => {
    const result = mergeForceParams(undefined);
    expect(result).toEqual({ ...DEFAULT_FORCE_PARAMS });
  });

  test("overrides only specified volatility fields", () => {
    const result = mergeForceParams({ volatility: { lookback: 48, criticalForce: 20 } });
    expect(result.volatility.lookback).toBe(48);
    expect(result.volatility.criticalForce).toBe(20);
    expect(result.momentum.lookback).toBe(DEFAULT_FORCE_PARAMS.momentum.lookback);
  });

  test("overrides only rsThreshold", () => {
    const result = mergeForceParams({ rsThreshold: 0.15 });
    expect(result.rsThreshold).toBe(0.15);
    expect(result.volatility).toEqual(DEFAULT_FORCE_PARAMS.volatility);
    expect(result.baseRange).toEqual(DEFAULT_FORCE_PARAMS.baseRange);
  });

  test("partial trend overrides merge correctly", () => {
    const result = mergeForceParams({
      trend: { lookback: 72, bullishFrom: 65, bearishFrom: 35, biasExp: 0.02, biasDivider: 4 },
    });
    expect(result.trend.lookback).toBe(72);
    expect(result.trend.bullishFrom).toBe(65);
    expect(result.trend.bearishFrom).toBe(35);
    expect(result.trend.biasExp).toBe(0.02);
    expect(result.trend.biasDivider).toBe(4);
  });

  test("baseRange partial override", () => {
    const result = mergeForceParams({
      baseRange: { min: 0.001, max: 0.05, vforceExp: -0.5, vforceDivider: 400 },
    });
    expect(result.baseRange.min).toBe(0.001);
    expect(result.baseRange.max).toBe(0.05);
    expect(result.baseRange.vforceExp).toBe(-0.5);
    expect(result.baseRange.vforceDivider).toBe(400);
  });

  test("returns a fresh object (no mutation of defaults)", () => {
    const r1 = mergeForceParams();
    const r2 = mergeForceParams();
    r1.rsThreshold = 999;
    expect(r2.rsThreshold).toBe(DEFAULT_FORCE_PARAMS.rsThreshold);
  });
});
