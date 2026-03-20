// Shared formatting utilities between backend and dashboard.

export { chainName, chainGasCostUsd } from "./chains";

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
export const fmtDuration = (ms: number, detailed = false): string => {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (detailed && s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---- Candle aggregation ----

import type { Candle } from "./types";

/** Aggregate candles into higher timeframes by period in milliseconds. */
export function aggregateCandles(source: Candle[], periodMs: number): Candle[] {
  const buckets = new Map<number, Candle>();
  for (const c of source) {
    const key = Math.floor(c.ts / periodMs) * periodMs;
    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, { ts: key, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v });
    } else {
      existing.h = Math.max(existing.h, c.h);
      existing.l = Math.min(existing.l, c.l);
      existing.c = c.c;
      existing.v += c.v;
    }
  }
  return [...buckets.values()].sort((a, b) => a.ts - b.ts);
}

// ---- Simple moving average (sliding window, O(n)) ----

export function sma(values: number[], period: number): number[] {
  if (period > values.length) return [];
  const r: number[] = [];
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  r.push(sum / period);
  for (let i = period; i < values.length; i++) {
    sum += values[i] - values[i - period];
    r.push(sum / period);
  }
  return r;
}

// ---- Pair ID parsing ----

export function pairTokens(pairId: string): [string, string] {
  const parts = pairId.split(/[-_/]/);
  return parts.length >= 2 ? [parts[0], parts[1]] : ["Token A", "Token B"];
}

// ---- Tick math (Uniswap V3 tick base) ----

const TICK_BASE = 1.0001;
export const tickToPrice = (tick: number) => Math.pow(TICK_BASE, tick);
export const priceToTick = (price: number) =>
  Math.floor(Math.log(Math.max(price, 1e-18)) / Math.log(TICK_BASE));
