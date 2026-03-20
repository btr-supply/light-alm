import { RSI_PERIOD, RETRY } from "./config/params";
import { structuredLog, LEVELS, type Level } from "./infra/logger";
import { errMsg } from "../shared/format";
import type { Candle } from "./types";
import { chainGasCostUsd } from "../shared/chains";

export { errMsg };
export const log = structuredLog;

export function isValidLogLevel(l: string): l is Level {
  return l in LEVELS;
}

export const mean = (a: number[]) => (a.length === 0 ? 0 : a.reduce((s, v) => s + v, 0) / a.length);
export const std = (a: number[]) => {
  if (a.length === 0) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);
};

export { sma } from "../shared/format";

export function rsi(values: number[], period = RSI_PERIOD): number {
  if (values.length < period + 1) return 50;
  const start = values.length - period;
  const earliest = Math.max(1, start - period * 4);
  let avgGain = 0,
    avgLoss = 0;
  for (let i = earliest; i < earliest + period && i < values.length; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) avgGain += d;
    else avgLoss -= d;
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = earliest + period; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    const gain = d > 0 ? d : 0;
    const loss = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

// ---- Rate limiter (concurrency-safe via queue) ----

export class RateLimiter {
  private last = 0;
  private pending: Promise<void> = Promise.resolve();
  constructor(private minIntervalMs: number) {}

  async wait() {
    const p = this.pending.then(async () => {
      const now = Date.now();
      const wait = this.minIntervalMs - (now - this.last);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait + Math.random() * 200));
      this.last = Date.now();
    });
    this.pending = p;
    await p;
    if (this.pending === p) this.pending = Promise.resolve();
  }
}

// ---- Retry ----

export async function retry<T>(
  fn: () => Promise<T>,
  maxRetries: number = RETRY.default.count,
  backoffBase: number = RETRY.default.backoffMs,
): Promise<T> {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (e: unknown) {
      if (i === maxRetries) throw e;
      const delay = backoffBase * 2 ** i;
      log.warn(`Retry ${i + 1}/${maxRetries} in ${delay}ms: ${errMsg(e)}`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("unreachable");
}

// ---- Fallback wrapper (try op, log.warn + return fallback on error) ----

export async function withFallback<T>(
  fn: () => Promise<T>,
  fallback: T,
  context: string,
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    log.warn(`${context}: ${errMsg(e)}`);
    return fallback;
  }
}

// ---- Token sorting ----

export function sortTokens(a: `0x${string}`, b: `0x${string}`): [`0x${string}`, `0x${string}`] {
  return a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
}

export function sortTokensWithAmounts(
  t0: `0x${string}`,
  t1: `0x${string}`,
  a0: bigint,
  a1: bigint,
) {
  const needsSwap = t0.toLowerCase() > t1.toLowerCase();
  return {
    tokens: (needsSwap ? [t1, t0] : [t0, t1]) as [`0x${string}`, `0x${string}`],
    amounts: needsSwap ? ([a1, a0] as [bigint, bigint]) : ([a0, a1] as [bigint, bigint]),
  };
}

// ---- BigInt-safe JSON replacer (shared across store-dragonfly + O2) ----

export const bigintReplacer = (_: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

// ---- Binary search ----

/** Index of first candle with ts > target (upper bound). */
export function upperBound(arr: Candle[], target: number): number {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid].ts <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// ---- Impermanent loss ----

/**
 * Compute unrealized impermanent loss from position entry prices vs current price.
 * Uses the standard IL formula: IL = 2*sqrt(r)/(1+r) - 1 where r = currentPrice/entryPrice
 */
export function computeIL(
  positions: { entryPrice: number; entryValueUsd: number }[],
  currentPrice: number,
): number {
  let total = 0;
  for (const p of positions) {
    if (p.entryPrice <= 0 || currentPrice <= 0) continue;
    const r = currentPrice / p.entryPrice;
    const ilFraction = (2 * Math.sqrt(r)) / (1 + r) - 1;
    total += Math.abs(ilFraction) * p.entryValueUsd;
  }
  return total;
}

// ---- BigInt scaling ----

const SCALE_PRECISION = 1_000_000_000n;
export function scaleByPct(balance: bigint, pct: number): bigint {
  return (balance * BigInt(Math.round(pct * Number(SCALE_PRECISION)))) / SCALE_PRECISION;
}

// ---- Per-pair gas cost ----

/** Average gas cost across a pair's pool chains. */
export function pairGasCost(pools: { chain: number }[]): number {
  const chainSet = new Set(pools.map((p) => p.chain));
  return [...chainSet].reduce((s, c) => s + chainGasCostUsd(c), 0) / Math.max(chainSet.size, 1);
}
