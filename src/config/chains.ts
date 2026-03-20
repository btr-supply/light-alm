import type { ChainConfig } from "../types";
import type { RedisClient } from "bun";
import { CHAINS } from "../../shared/chains";

// ---- Default public RPC endpoints per chain (only chains with active pools) ----

export const DEFAULT_RPCS: Record<number, string[]> = {
  1: ["https://eth.drpc.org", "https://rpc.ankr.com/eth", "https://ethereum-rpc.publicnode.com"],
  56: [
    "https://bsc-dataseed.binance.org",
    "https://rpc.ankr.com/bsc",
    "https://bsc-rpc.publicnode.com",
  ],
  137: [
    "https://polygon-rpc.com",
    "https://rpc.ankr.com/polygon",
    "https://polygon-bor-rpc.publicnode.com",
  ],
  999: ["https://rpc.hyperliquid.xyz/evm"],
  8453: [
    "https://mainnet.base.org",
    "https://rpc.ankr.com/base",
    "https://base-rpc.publicnode.com",
  ],
  42161: [
    "https://arb1.arbitrum.io/rpc",
    "https://rpc.ankr.com/arbitrum",
    "https://arbitrum-one-rpc.publicnode.com",
  ],
  43114: [
    "https://api.avax.network/ext/bc/C/rpc",
    "https://rpc.ankr.com/avalanche",
    "https://avalanche-c-chain-rpc.publicnode.com",
  ],
};

// ---- Legacy env var mapping (old RPC_<NAME> format) ----

const LEGACY_ENV: Record<number, string> = {
  1: "RPC_ETHEREUM",
  56: "RPC_BNB",
  137: "RPC_POLYGON",
  999: "RPC_HYPEREVM",
  8453: "RPC_BASE",
  42161: "RPC_ARBITRUM",
  43114: "RPC_AVALANCHE",
};

// Runtime overrides (set by DragonflyDB hot reload or setChainRpcs)
const runtimeOverrides = new Map<number, string[]>();

/** Deduplicate URLs preserving order. */
function dedup(urls: string[]): string[] {
  const seen = new Set<string>();
  return urls.filter((u) => {
    if (seen.has(u)) return false;
    seen.add(u);
    return true;
  });
}

/**
 * Resolve RPC URLs for a chain with priority:
 * 1. Runtime overrides (from DragonflyDB)
 * 2. HTTP_RPCS_<chainId> env (comma-separated, prepended to defaults)
 * 3. Legacy RPC_<NAME> env (prepended to defaults)
 * 4. DEFAULT_RPCS
 */
export function resolveRpcs(chainId: number): string[] {
  const override = runtimeOverrides.get(chainId);
  if (override?.length) return override;

  const defaults = DEFAULT_RPCS[chainId] ?? [];

  const envNew = process.env[`HTTP_RPCS_${chainId}`];
  if (envNew)
    return dedup([
      ...envNew
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      ...defaults,
    ]);

  const legacyKey = LEGACY_ENV[chainId];
  const envLegacy = legacyKey ? process.env[legacyKey] : undefined;
  if (envLegacy) return dedup([envLegacy.trim(), ...defaults]);

  return defaults;
}

/** Set runtime RPC override for a chain (e.g. from DragonflyDB hot reload). */
export function setChainRpcs(chainId: number, rpcs: string[]): void {
  if (rpcs.length) runtimeOverrides.set(chainId, rpcs);
  else runtimeOverrides.delete(chainId);
}

/** Load all RPC overrides from DragonflyDB into runtime state. */
export async function loadRpcOverrides(redis: RedisClient): Promise<number> {
  const { KEYS } = await import("../infra/redis");
  const chainIds = await redis.smembers(KEYS.rpcChains);
  const results = await Promise.all(
    chainIds.map(async (idStr) => {
      const chainId = Number(idStr);
      const raw = await redis.get(KEYS.rpcChain(chainId));
      if (raw) {
        const rpcs = JSON.parse(raw) as string[];
        if (rpcs.length) {
          setChainRpcs(chainId, rpcs);
          return true;
        }
      }
      return false;
    }),
  );
  return results.filter(Boolean).length;
}

// ---- Chain configs (built from shared metadata + RPCs) ----

function buildChain(id: number): ChainConfig {
  const meta = CHAINS[id] ?? {};
  return {
    id: id as ChainConfig["id"],
    name: meta.name ?? `Chain ${id}`,
    rpcs: resolveRpcs(id),
    gecko: meta.gecko,
    blockTimeMs: meta.blockTimeMs,
    nativeSymbol: meta.nativeSymbol,
  };
}

export const chains: Record<number, ChainConfig> = Object.fromEntries(
  Object.keys(DEFAULT_RPCS).map((id) => [Number(id), buildChain(Number(id))]),
);

export const getChain = (id: number): ChainConfig => {
  const c = chains[id];
  if (!c) throw new Error(`Unknown chain ${id}`);
  return c;
};

export const geckoNetwork = (chainId: number): string => {
  const g = getChain(chainId).gecko;
  if (!g) throw new Error(`No GeckoTerminal slug for chain ${chainId}`);
  return g;
};
