import { describe, expect, test } from "bun:test";
import { configEntryToStrategy, strategyToConfigEntry } from "../../src/config/strategies";
import { KEYS } from "../../src/infra/redis";
import { TOKENS } from "../../src/config/tokens";
import type { StrategyConfigEntry } from "../../shared/types";
import type { StrategyConfig } from "../../src/types";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** Minimal valid entry — only required fields, no optionals. */
const minimalEntry: StrategyConfigEntry = {
  name: "V1",
  pairId: "USDC-USDT",
  pkEnvVar: "V1_PK",
  pools: [
    {
      chain: 1,
      address: "0x3416cf6c708da44db2624d63ea0aaef7113527c6",
      dex: "uni-v3",
    },
  ],
  intervalSec: 900,
  maxPositions: 3,
  thresholds: { pra: 0.05, rs: 0.25 },
};

/** Entry with all optional fields populated. */
const fullEntry: StrategyConfigEntry = {
  ...minimalEntry,
  name: "V2",
  pkEnvVar: "V2_PK",
  pools: [
    {
      chain: 1,
      address: "0x3416cf6c708da44db2624d63ea0aaef7113527c6",
      dex: "uni-v3",
    },
    {
      chain: 42161,
      address: "0xbe3ad6a5669dc0b8b12febc03608860c31e2eef6",
      dex: "uni-v3",
    },
  ],
  forceParams: { volatility: { lookback: 48, criticalForce: 20 } },
  gasReserves: { 1: 0.05, 42161: 0.01 },
  allocationPct: 0.5,
  rpcOverrides: { 1: ["https://rpc1.example.com", "https://rpc2.example.com"] },
};

/** Entry with an unknown token pair. */
const unknownPairEntry: StrategyConfigEntry = {
  ...minimalEntry,
  pairId: "FAKE-TOKEN",
};

// ---------------------------------------------------------------------------
// configEntryToStrategy()
// ---------------------------------------------------------------------------

describe("configEntryToStrategy", () => {
  test("converts a valid entry to a StrategyConfig with resolved tokens", () => {
    const result = configEntryToStrategy(minimalEntry);
    expect(result).not.toBeNull();
    const cfg = result as StrategyConfig;

    expect(cfg.name).toBe("V1");
    expect(cfg.pairId).toBe("USDC-USDT");
    expect(cfg.pkEnvVar).toBe("V1_PK");
    expect(cfg.token0).toBe(TOKENS["USDC"]);
    expect(cfg.token1).toBe(TOKENS["USDT"]);
    expect(cfg.pools).toHaveLength(1);
    expect(cfg.pools[0].chain).toBe(1);
    expect(cfg.pools[0].address).toBe("0x3416cf6c708da44db2624d63ea0aaef7113527c6");
    expect(cfg.pools[0].dex).toBe("uni-v3");
    expect(cfg.intervalSec).toBe(900);
    expect(cfg.maxPositions).toBe(3);
    expect(cfg.thresholds.pra).toBe(0.05);
    expect(cfg.thresholds.rs).toBe(0.25);
  });

  test("returns null when token pair is unknown", () => {
    const result = configEntryToStrategy(unknownPairEntry);
    expect(result).toBeNull();
  });

  test("preserves optional fields when present", () => {
    const result = configEntryToStrategy(fullEntry);
    expect(result).not.toBeNull();
    const cfg = result as StrategyConfig;

    expect(cfg.forceParams).toEqual({ volatility: { lookback: 48, criticalForce: 20 } });
    expect(cfg.gasReserves).toEqual({ 1: 0.05, 42161: 0.01 });
    expect(cfg.allocationPct).toBe(0.5);
    expect(cfg.rpcOverrides).toEqual({
      1: ["https://rpc1.example.com", "https://rpc2.example.com"],
    });
  });

  test("handles entry with no optional fields gracefully", () => {
    const result = configEntryToStrategy(minimalEntry);
    expect(result).not.toBeNull();
    const cfg = result as StrategyConfig;

    expect(cfg.forceParams).toBeUndefined();
    expect(cfg.gasReserves).toBeUndefined();
    expect(cfg.allocationPct).toBeUndefined();
    expect(cfg.rpcOverrides).toBeUndefined();
  });

  test("converts multiple pools with correct types", () => {
    const result = configEntryToStrategy(fullEntry);
    expect(result).not.toBeNull();
    const cfg = result as StrategyConfig;

    expect(cfg.pools).toHaveLength(2);
    expect(cfg.pools[0].chain).toBe(1);
    expect(cfg.pools[1].chain).toBe(42161);
    expect(cfg.pools[1].address).toBe("0xbe3ad6a5669dc0b8b12febc03608860c31e2eef6");
    expect(cfg.pools[1].dex).toBe("uni-v3");
  });
});

// ---------------------------------------------------------------------------
// strategyToConfigEntry()
// ---------------------------------------------------------------------------

describe("strategyToConfigEntry", () => {
  test("converts a StrategyConfig back to a storable entry", () => {
    const cfg = configEntryToStrategy(minimalEntry) as StrategyConfig;
    const entry = strategyToConfigEntry(cfg);

    expect(entry.name).toBe(minimalEntry.name);
    expect(entry.pairId).toBe(minimalEntry.pairId);
    expect(entry.pkEnvVar).toBe(minimalEntry.pkEnvVar);
    expect(entry.intervalSec).toBe(minimalEntry.intervalSec);
    expect(entry.maxPositions).toBe(minimalEntry.maxPositions);
    expect(entry.thresholds).toEqual(minimalEntry.thresholds);
    expect(entry.pools).toHaveLength(1);
    expect(entry.pools[0].address).toBe(minimalEntry.pools[0].address);
    expect(entry.pools[0].chain).toBe(minimalEntry.pools[0].chain);
    expect(entry.pools[0].dex).toBe(minimalEntry.pools[0].dex);
  });

  test("round-trip preserves all required fields", () => {
    const cfg = configEntryToStrategy(minimalEntry) as StrategyConfig;
    const roundTripped = strategyToConfigEntry(cfg);

    expect(roundTripped.name).toBe(minimalEntry.name);
    expect(roundTripped.pairId).toBe(minimalEntry.pairId);
    expect(roundTripped.pkEnvVar).toBe(minimalEntry.pkEnvVar);
    expect(roundTripped.pools).toEqual(minimalEntry.pools);
    expect(roundTripped.intervalSec).toBe(minimalEntry.intervalSec);
    expect(roundTripped.maxPositions).toBe(minimalEntry.maxPositions);
    expect(roundTripped.thresholds).toEqual(minimalEntry.thresholds);
  });

  test("preserves all optional fields in the conversion", () => {
    const cfg = configEntryToStrategy(fullEntry) as StrategyConfig;
    const entry = strategyToConfigEntry(cfg);

    expect(entry.forceParams).toEqual(fullEntry.forceParams);
    expect(entry.gasReserves).toEqual(fullEntry.gasReserves);
    expect(entry.allocationPct).toBe(fullEntry.allocationPct);
    expect(entry.rpcOverrides).toEqual(fullEntry.rpcOverrides);
  });

  test("optional fields are undefined when not set on input", () => {
    const cfg = configEntryToStrategy(minimalEntry) as StrategyConfig;
    const entry = strategyToConfigEntry(cfg);

    expect(entry.forceParams).toBeUndefined();
    expect(entry.gasReserves).toBeUndefined();
    expect(entry.allocationPct).toBeUndefined();
    expect(entry.rpcOverrides).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Redis KEYS: strategy namespace
// ---------------------------------------------------------------------------

describe("Redis KEYS: strategy namespace", () => {
  test("strategy config keys are namespaced correctly", () => {
    expect(KEYS.configStrategy("V1")).toBe("btr:config:strategy:V1");
    expect(KEYS.configStrategy("arb-stable")).toBe("btr:config:strategy:arb-stable");
  });

  test("configStrategies set key is correct", () => {
    expect(KEYS.configStrategies).toBe("btr:config:strategies");
  });

  test("configDexs and configDex keys are correct", () => {
    expect(KEYS.configDexs).toBe("btr:config:dexs");
    expect(KEYS.configDex("uni-v3")).toBe("btr:config:dex:uni-v3");
    expect(KEYS.configDex("pcs-v3")).toBe("btr:config:dex:pcs-v3");
  });

  test("configPools key is correct", () => {
    expect(KEYS.configPools("USDC-USDT")).toBe("btr:config:pools:USDC-USDT");
  });

  test("worker keys use strategy name, not pair ID", () => {
    expect(KEYS.workerLock("V1")).toBe("btr:worker:V1:lock");
    expect(KEYS.workerHeartbeat("V1")).toBe("btr:worker:V1:heartbeat");
    expect(KEYS.workerState("V1")).toBe("btr:worker:V1:state");
    expect(KEYS.workerRestarting("V1")).toBe("btr:worker:V1:restarting");
  });
});

