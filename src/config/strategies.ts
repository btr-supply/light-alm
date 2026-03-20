import type { StrategyConfig } from "../types";
import type { StrategyConfigEntry } from "../../shared/types";
import { log } from "../utils";
import { parsePairTokens, loadPoolsFromEnv, envInt, loadThresholds, toPoolConfigsFromEntry, toPoolEntries } from "./config-utils";
import { DEFAULT_CYCLE_SEC, DEFAULT_MAX_POSITIONS } from "./params";

/**
 * Load strategy configs from env vars.
 * Supports two modes:
 * 1. STRATEGIES=V1,V2 with V1_PAIR=USDC-USDT, V1_PK=0x..., etc.
 * 2. Fallback: auto-create one strategy per pair from PAIRS env var (legacy compat)
 */
export function loadStrategyConfigs(): StrategyConfig[] {
  const strategiesRaw = process.env.STRATEGIES;

  if (strategiesRaw) {
    const names = strategiesRaw.split(",").map((s) => s.trim()).filter(Boolean);
    const configs: StrategyConfig[] = [];

    for (const name of names) {
      const pairId = process.env[`${name}_PAIR`];
      if (!pairId) { log.warn(`Strategy ${name}: missing ${name}_PAIR env var, skipping`); continue; }
      const tokens = parsePairTokens(pairId);
      if (!tokens) { log.warn(`Strategy ${name}: unknown token pair ${pairId}, skipping`); continue; }
      const pools = loadPoolsFromEnv(pairId, name);
      if (!pools.length) { log.warn(`Strategy ${name}: no pools for ${pairId}, skipping`); continue; }

      const allocPctRaw = process.env[`${name}_ALLOCATION_PCT`];
      configs.push({
        name, pairId,
        pkEnvVar: `PK_${name.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase()}`,
        token0: tokens[0], token1: tokens[1], pools,
        intervalSec: envInt(process.env[`${name}_INTERVAL`] || process.env.INTERVAL_SEC, DEFAULT_CYCLE_SEC, 1),
        maxPositions: envInt(process.env[`${name}_MAX_POSITIONS`] || process.env.MAX_POSITIONS, DEFAULT_MAX_POSITIONS, 1),
        thresholds: loadThresholds(name),
        allocationPct: allocPctRaw ? parseFloat(allocPctRaw) : undefined,
      });
    }
    return configs;
  }

  // Fallback: auto-create one strategy per pair (legacy compat)
  const configs: StrategyConfig[] = [];
  for (const pairId of (process.env.PAIRS || "USDC-USDT").split(",")) {
    const tokens = parsePairTokens(pairId);
    if (!tokens) { log.warn(`Unknown token pair ${pairId}, skipping`); continue; }
    const pools = loadPoolsFromEnv(pairId);
    if (!pools.length) { log.warn(`No pools configured for ${pairId}, skipping`); continue; }
    configs.push({
      name: pairId, pairId,
      pkEnvVar: `PK_${pairId.replace("-", "_")}`,
      token0: tokens[0], token1: tokens[1], pools,
      intervalSec: envInt(process.env.INTERVAL_SEC, DEFAULT_CYCLE_SEC, 1),
      maxPositions: envInt(process.env.MAX_POSITIONS, DEFAULT_MAX_POSITIONS, 1),
      thresholds: loadThresholds(),
    });
  }
  return configs;
}

export function configEntryToStrategy(entry: StrategyConfigEntry): StrategyConfig | null {
  const tokens = parsePairTokens(entry.pairId);
  if (!tokens) return null;
  return {
    name: entry.name, pairId: entry.pairId, pkEnvVar: entry.pkEnvVar,
    token0: tokens[0], token1: tokens[1],
    pools: toPoolConfigsFromEntry(entry.pools),
    intervalSec: entry.intervalSec, maxPositions: entry.maxPositions,
    thresholds: entry.thresholds, forceParams: entry.forceParams,
    gasReserves: entry.gasReserves, allocationPct: entry.allocationPct,
    rpcOverrides: entry.rpcOverrides,
  };
}

export function strategyToConfigEntry(config: StrategyConfig): StrategyConfigEntry {
  return {
    name: config.name, pairId: config.pairId, pkEnvVar: config.pkEnvVar,
    pools: toPoolEntries(config.pools),
    intervalSec: config.intervalSec, maxPositions: config.maxPositions,
    thresholds: config.thresholds, forceParams: config.forceParams,
    gasReserves: config.gasReserves, allocationPct: config.allocationPct,
    rpcOverrides: config.rpcOverrides,
  };
}
