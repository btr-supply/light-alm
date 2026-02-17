// Shared formatting utilities and constants between backend and dashboard.

export const GAS_COST_USD = 0.5;

export const cap = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
export const fmtPct = (v: number, decimals = 2) => `${(v * 100).toFixed(decimals)}%`;
export const fmtNum = (v: number, decimals = 4) => v.toFixed(decimals);
export const fmtUsd = (v: number) => `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
export const fmtGasCost = (gasUsed: string, gasPrice: string) => {
  const cost = (Number(gasUsed) * Number(gasPrice)) / 1e18;
  return cost > 0 ? cost.toFixed(4) : "-";
};
export const shortAddr = (addr: string, front = 6, back = 4) =>
  back > 0 ? `${addr.slice(0, front)}...${addr.slice(-back)}` : `${addr.slice(0, front)}...`;
export const fmtTime = (ts: number) =>
  ts ? new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "-";

const CHAIN_NAME: Record<number, string> = {
  1: "Ethereum",
  56: "BSC",
  8453: "Base",
  42161: "Arbitrum",
  43114: "Avalanche",
  137: "Polygon",
  999: "HyperEVM",
};

export const chainName = (id: number) => CHAIN_NAME[id] ?? `Chain ${id}`;
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---- Tick math (Uniswap V3 tick base) ----

const TICK_BASE = 1.0001;
export const tickToPrice = (tick: number) => Math.pow(TICK_BASE, tick);
export const priceToTick = (price: number) =>
  Math.floor(Math.log(Math.max(price, 1e-18)) / Math.log(TICK_BASE));
