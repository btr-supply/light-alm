// Single source of truth for chain metadata.
// Consolidates name, gas cost, UI color, gecko slug, block time, native symbol.

interface ChainMeta {
  name: string;
  gasCostUsd: number;
  color?: { tw: string; hex: string };
  gecko?: string;
  blockTimeMs?: number;
  nativeSymbol?: string;
}

export const CHAINS: Record<number, ChainMeta> = {
  1: { name: "Ethereum", gasCostUsd: 5.0, color: { tw: "bg-blue-500", hex: "#3b82f6" }, gecko: "eth", blockTimeMs: 12_000, nativeSymbol: "ETH" },
  56: { name: "BSC", gasCostUsd: 0.15, color: { tw: "bg-yellow-500", hex: "#eab308" }, gecko: "bsc", blockTimeMs: 3_000, nativeSymbol: "BNB" },
  137: { name: "Polygon", gasCostUsd: 0.08, color: { tw: "bg-purple-500", hex: "#a855f7" }, gecko: "polygon_pos", blockTimeMs: 2_000, nativeSymbol: "POL" },
  999: { name: "HyperEVM", gasCostUsd: 0.02, color: { tw: "bg-emerald-500", hex: "#10b981" }, gecko: "hyperevm", blockTimeMs: 2_000, nativeSymbol: "HYPE" },
  8453: { name: "Base", gasCostUsd: 0.05, color: { tw: "bg-sky-500", hex: "#0ea5e9" }, gecko: "base", blockTimeMs: 2_000, nativeSymbol: "ETH" },
  42161: { name: "Arbitrum", gasCostUsd: 0.10, color: { tw: "bg-violet-500", hex: "#8b5cf6" }, gecko: "arbitrum", blockTimeMs: 250, nativeSymbol: "ETH" },
  43114: { name: "Avalanche", gasCostUsd: 0.15, color: { tw: "bg-red-500", hex: "#ef4444" }, gecko: "avax", blockTimeMs: 2_000, nativeSymbol: "AVAX" },
};

export const chainName = (id: number) => CHAINS[id]?.name ?? `Chain ${id}`;
export const chainGasCostUsd = (id: number) => CHAINS[id]?.gasCostUsd ?? 0.10;
export const chainColor = (id: number) => CHAINS[id]?.color;
