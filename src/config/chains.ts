import type { ChainConfig } from "../types";

export const chains: Record<number, ChainConfig> = {
  1: {
    id: 1,
    name: "Ethereum",
    rpc: process.env.RPC_ETHEREUM || "https://eth.drpc.org",
    gecko: "eth",
    blockTimeMs: 12_000,
    nativeSymbol: "ETH",
  },
  56: {
    id: 56,
    name: "BSC",
    rpc: process.env.RPC_BNB || "https://bsc-dataseed.binance.org",
    gecko: "bsc",
    blockTimeMs: 3_000,
    nativeSymbol: "BNB",
  },
  137: {
    id: 137,
    name: "Polygon",
    rpc: process.env.RPC_POLYGON || "https://polygon-rpc.com",
    gecko: "polygon_pos",
    blockTimeMs: 2_000,
    nativeSymbol: "POL",
  },
  8453: {
    id: 8453,
    name: "Base",
    rpc: process.env.RPC_BASE || "https://mainnet.base.org",
    gecko: "base",
    blockTimeMs: 2_000,
    nativeSymbol: "ETH",
  },
  42161: {
    id: 42161,
    name: "Arbitrum",
    rpc: process.env.RPC_ARBITRUM || "https://arb1.arbitrum.io/rpc",
    gecko: "arbitrum",
    blockTimeMs: 250,
    nativeSymbol: "ETH",
  },
  43114: {
    id: 43114,
    name: "Avalanche",
    rpc: process.env.RPC_AVALANCHE || "https://api.avax.network/ext/bc/C/rpc",
    gecko: "avax",
    blockTimeMs: 2_000,
    nativeSymbol: "AVAX",
  },
  999: {
    id: 999,
    name: "HyperEVM",
    rpc: process.env.RPC_HYPEREVM || "https://rpc.hyperliquid.xyz/evm",
    gecko: "hyperevm",
    blockTimeMs: 2_000,
    nativeSymbol: "HYPE",
  },
};

export const getChain = (id: number) => {
  const c = chains[id];
  if (!c) throw new Error(`Unknown chain ${id}`);
  return c;
};

export const geckoNetwork = (chainId: number) => getChain(chainId).gecko;
