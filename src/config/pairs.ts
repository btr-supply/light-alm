import type { PairConfig, PoolConfig, DexId } from "../types";
import { log } from "../utils";
import { TOKENS } from "./tokens";
import { POOL_REGISTRY, toPoolConfigs } from "./pools";

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

    const intervalSec = parseInt(process.env.INTERVAL_SEC || "900");
    const maxPositions = parseInt(process.env.MAX_POSITIONS || "3");
    if (isNaN(intervalSec) || intervalSec <= 0) {
      log.error(`Invalid INTERVAL_SEC, using default 900`);
    }
    if (isNaN(maxPositions) || maxPositions <= 0) {
      log.error(`Invalid MAX_POSITIONS, using default 3`);
    }

    pairs.push({
      id,
      token0,
      token1,
      eoaEnvVar: `PK_${id.replace("-", "_")}`,
      pools,
      intervalSec: isNaN(intervalSec) || intervalSec <= 0 ? 900 : intervalSec,
      maxPositions: isNaN(maxPositions) || maxPositions <= 0 ? 3 : maxPositions,
      thresholds: {
        pra: parseFloat(process.env.PRA_THRESHOLD || "0.05"),
        rs: parseFloat(process.env.RS_THRESHOLD || "0.25"),
      },
    });
  }
  return pairs;
}
