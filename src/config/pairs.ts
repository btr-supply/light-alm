import type { PairConfig, PoolConfig, DexId } from "../types";
import type { PairConfigEntry } from "../infra/redis";
import { log } from "../utils";
import { TOKENS } from "./tokens";
import { POOL_REGISTRY, toPoolConfigs } from "./pools";
import {
  DEFAULT_INTERVAL_SEC,
  DEFAULT_MAX_POSITIONS,
  DEFAULT_PRA_THRESHOLD,
  DEFAULT_RS_THRESHOLD,
} from "./params";

function loadPoolsFromEnv(pairId: string): PoolConfig[] {
  const envKey = `POOLS_${pairId.replace("-", "_")}`;
  const raw = process.env[envKey];
  if (!raw) {
    const entries = POOL_REGISTRY[pairId];
    return entries ? toPoolConfigs(entries) : [];
  }
  return raw.split(",").map((entry) => {
    const [chain, address, dex] = entry.split(":");
    return { chain: parseInt(chain), address: address as `0x${string}`, dex: dex as DexId };
  });
}

export function loadPairConfigs(): PairConfig[] {
  const pairs: PairConfig[] = [];
  const pairIds = (process.env.PAIRS || "USDC-USDT").split(",");

  for (const id of pairIds) {
    const [sym0, sym1] = id.split("-");
    const token0 = TOKENS[sym0];
    const token1 = TOKENS[sym1];
    if (!token0 || !token1) {
      log.warn(`Unknown token pair ${id}, skipping`);
      continue;
    }

    const pools = loadPoolsFromEnv(id);
    if (!pools.length) {
      log.warn(`No pools configured for ${id}, skipping`);
      continue;
    }

    const intervalSec = parseInt(process.env.INTERVAL_SEC || String(DEFAULT_INTERVAL_SEC));
    const maxPositions = parseInt(process.env.MAX_POSITIONS || String(DEFAULT_MAX_POSITIONS));
    if (isNaN(intervalSec) || intervalSec <= 0) {
      log.error(`Invalid INTERVAL_SEC, using default ${DEFAULT_INTERVAL_SEC}`);
    }
    if (isNaN(maxPositions) || maxPositions <= 0) {
      log.error(`Invalid MAX_POSITIONS, using default ${DEFAULT_MAX_POSITIONS}`);
    }

    const pra = parseFloat(process.env.PRA_THRESHOLD || String(DEFAULT_PRA_THRESHOLD));
    const rs = parseFloat(process.env.RS_THRESHOLD || String(DEFAULT_RS_THRESHOLD));

    pairs.push({
      id,
      token0,
      token1,
      eoaEnvVar: `PK_${id.replace("-", "_")}`,
      pools,
      intervalSec: isNaN(intervalSec) || intervalSec <= 0 ? DEFAULT_INTERVAL_SEC : intervalSec,
      maxPositions: isNaN(maxPositions) || maxPositions <= 0 ? DEFAULT_MAX_POSITIONS : maxPositions,
      thresholds: {
        pra: isNaN(pra) || pra <= 0 || pra >= 1 ? DEFAULT_PRA_THRESHOLD : pra,
        rs: isNaN(rs) || rs <= 0 || rs >= 1 ? DEFAULT_RS_THRESHOLD : rs,
      },
    });
  }
  return pairs;
}

/** Convert a DragonflyDB config entry into a full PairConfig. Returns null if tokens unknown. */
export function configEntryToPair(entry: PairConfigEntry): PairConfig | null {
  const [sym0, sym1] = entry.id.split("-");
  const token0 = TOKENS[sym0];
  const token1 = TOKENS[sym1];
  if (!token0 || !token1) return null;
  return {
    id: entry.id,
    token0,
    token1,
    eoaEnvVar: `PK_${entry.id.replace("-", "_")}`,
    pools: entry.pools.map((p) => ({
      chain: p.chain,
      address: p.address as `0x${string}`,
      dex: p.dex,
    })),
    intervalSec: entry.intervalSec,
    maxPositions: entry.maxPositions,
    thresholds: entry.thresholds,
    forceParams: entry.forceParams,
  };
}

/** Convert a PairConfig to a storable DragonflyDB entry. */
export function pairToConfigEntry(pair: PairConfig): PairConfigEntry {
  return {
    id: pair.id,
    pools: pair.pools.map((p) => ({
      chain: p.chain,
      address: p.address,
      dex: p.dex,
    })),
    intervalSec: pair.intervalSec,
    maxPositions: pair.maxPositions,
    thresholds: pair.thresholds,
    forceParams: pair.forceParams,
  };
}
