import type { PairConfig } from "../types";
import type { PairConfigEntry } from "../../shared/types";
import { log } from "../utils";
import { parsePairTokens, loadPoolsFromEnv, envInt, loadThresholds, toPoolConfigsFromEntry, toPoolEntries } from "./config-utils";
import { DEFAULT_CYCLE_SEC, DEFAULT_MAX_POSITIONS } from "./params";

export function loadPairConfigs(): PairConfig[] {
  const pairs: PairConfig[] = [];
  for (const id of (process.env.PAIRS || "USDC-USDT").split(",")) {
    const tokens = parsePairTokens(id);
    if (!tokens) { log.warn(`Unknown token pair ${id}, skipping`); continue; }
    const pools = loadPoolsFromEnv(id);
    if (!pools.length) { log.warn(`No pools configured for ${id}, skipping`); continue; }
    pairs.push({
      id, token0: tokens[0], token1: tokens[1],
      eoaEnvVar: `PK_${id.replace("-", "_")}`,
      pools,
      intervalSec: envInt(process.env.INTERVAL_SEC, DEFAULT_CYCLE_SEC, 1),
      maxPositions: envInt(process.env.MAX_POSITIONS, DEFAULT_MAX_POSITIONS, 1),
      thresholds: loadThresholds(),
    });
  }
  return pairs;
}

export function configEntryToPair(entry: PairConfigEntry): PairConfig | null {
  const tokens = parsePairTokens(entry.id);
  if (!tokens) return null;
  return {
    id: entry.id, token0: tokens[0], token1: tokens[1],
    eoaEnvVar: `PK_${entry.id.replace("-", "_")}`,
    pools: toPoolConfigsFromEntry(entry.pools),
    intervalSec: entry.intervalSec, maxPositions: entry.maxPositions,
    thresholds: entry.thresholds, forceParams: entry.forceParams as any,
  };
}

export function pairToConfigEntry(pair: PairConfig): PairConfigEntry {
  return {
    id: pair.id,
    pools: toPoolEntries(pair.pools),
    intervalSec: pair.intervalSec, maxPositions: pair.maxPositions,
    thresholds: pair.thresholds, forceParams: pair.forceParams as any,
  };
}
