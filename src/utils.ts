// ---- Logger (delegates to structured logger for dual-sink: console + OpenObserve) ----

import { RSI_PERIOD, DEFAULT_RETRY_COUNT, DEFAULT_RETRY_BACKOFF_MS } from "./config/params";
import { structuredLog, LEVELS, type Level, type LogFields } from "./infra/logger";
export type { LogFields };

export const log = {
  setLevel: (l: Level) => {
    structuredLog.setLevel(l);
  },
  debug: (msg: string, fields?: LogFields) => structuredLog.debug(msg, fields),
  info: (msg: string, fields?: LogFields) => structuredLog.info(msg, fields),
  warn: (msg: string, fields?: LogFields) => structuredLog.warn(msg, fields),
  error: (msg: string, fields?: LogFields) => structuredLog.error(msg, fields),
  flush: () => structuredLog.flush(),
  shutdown: () => structuredLog.shutdown(),
};

export function isValidLogLevel(l: string): l is Level {
  return l in LEVELS;
}

// ---- Re-exports from ../shared/format ----

import { errMsg } from "../shared/format";
export { cap, errMsg } from "../shared/format";
export const mean = (a: number[]) => (a.length === 0 ? 0 : a.reduce((s, v) => s + v, 0) / a.length);
export const std = (a: number[]) => {
  if (a.length === 0) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);
};

// Sliding window SMA — O(n) instead of O(n*k)
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

export function rsi(values: number[], period = RSI_PERIOD): number {
  if (values.length < period + 1) return 50;
  // Wilder's smoothing: seed with SMA, then EMA with alpha = 1/period
  const start = values.length - period;
  // Wilder's EMA over all available prior deltas (walk forward from earliest)
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
  maxRetries = DEFAULT_RETRY_COUNT,
  backoffBase = DEFAULT_RETRY_BACKOFF_MS,
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

/** Sort token addresses and swap corresponding amounts to match. */
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

// ---- Formatting (re-exported from ../shared/format) ----

export { fmtPct, fmtPct as pct, fmtUsd as usd } from "../shared/format";
