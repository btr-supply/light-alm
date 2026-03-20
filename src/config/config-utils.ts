import type { PoolConfig, DexId, TokenConfig } from "../types";
import { TOKENS } from "./tokens";
import { POOL_REGISTRY, toPoolConfigs } from "./pools";
import { DEFAULT_PRA_THRESHOLD, DEFAULT_RS_THRESHOLD } from "./params";

/** Parse "TOKEN0-TOKEN1" into token configs. Returns null if unknown. */
export function parsePairTokens(pairId: string): [TokenConfig, TokenConfig] | null {
  const [sym0, sym1] = pairId.split("-");
  const t0 = TOKENS[sym0], t1 = TOKENS[sym1];
  return t0 && t1 ? [t0, t1] : null;
}

/** Parse pool list from env var or fall back to POOL_REGISTRY. */
export function loadPoolsFromEnv(pairId: string, envPrefix?: string): PoolConfig[] {
  const keys = envPrefix
    ? [`${envPrefix}_POOLS`, `POOLS_${pairId.replace("-", "_")}`]
    : [`POOLS_${pairId.replace("-", "_")}`];
  for (const k of keys) {
    const raw = process.env[k];
    if (raw) {
      return raw.split(",").map((entry) => {
        const [chain, address, dex] = entry.split(":");
        return { chain: parseInt(chain), address: address as `0x${string}`, dex: dex as DexId };
      });
    }
  }
  const entries = POOL_REGISTRY[pairId];
  return entries ? toPoolConfigs(entries) : [];
}

/** Parse an int env var with NaN/range guard, returning fallback on failure. */
export function envInt(raw: string | undefined, fallback: number, min = 1, max = Infinity): number {
  const n = parseInt(raw || String(fallback));
  return isNaN(n) || n < min || n > max ? fallback : n;
}

/** Parse a float env var with NaN/range guard, returning fallback on failure. */
export function envFloat(raw: string | undefined, fallback: number, min = 0, max = 1): number {
  const n = parseFloat(raw || String(fallback));
  return isNaN(n) || n <= min || n >= max ? fallback : n;
}

/** Convert wire-format pool entries to typed PoolConfig[]. */
export function toPoolConfigsFromEntry(pools: { chain: number; address: string; dex: string }[]): PoolConfig[] {
  return pools.map((p) => ({ chain: p.chain, address: p.address as `0x${string}`, dex: p.dex as DexId }));
}

/** Convert typed PoolConfig[] to wire-format pool entries. */
export function toPoolEntries(pools: PoolConfig[]): { chain: number; address: string; dex: string }[] {
  return pools.map((p) => ({ chain: p.chain, address: p.address, dex: p.dex }));
}

/** Build thresholds from env vars with optional strategy prefix. */
export function loadThresholds(prefix?: string): { pra: number; rs: number } {
  return {
    pra: envFloat(
      prefix ? (process.env[`${prefix}_PRA_THRESHOLD`] || process.env.PRA_THRESHOLD) : process.env.PRA_THRESHOLD,
      DEFAULT_PRA_THRESHOLD,
    ),
    rs: envFloat(
      prefix ? (process.env[`${prefix}_RS_THRESHOLD`] || process.env.RS_THRESHOLD) : process.env.RS_THRESHOLD,
      DEFAULT_RS_THRESHOLD,
    ),
  };
}
