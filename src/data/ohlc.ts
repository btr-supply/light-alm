import ccxt, { type Exchange } from "ccxt";
import type { Candle } from "../types";
import type { DragonflyStore } from "./store-dragonfly";
import {
  TF,
  TF_MS,
  OHLC_SOURCES,
  BACKFILL_MS,
  OHLC_FETCH_LIMIT,
  OHLC_MAX_ITERATIONS,
  OHLC_LATEST_LOOKBACK_CANDLES,
  FETCH_TIMEOUT_MS,
} from "../config/params";
import { log } from "../utils";
import { ingestToO2 } from "../infra/o2";

// Cache exchange instances
const exchanges = new Map<string, Exchange>();

type ExchangeCtor = new (opts?: object) => Exchange;

function getExchange(id: string): Exchange {
  if (!exchanges.has(id)) {
    const Ctor = (ccxt as unknown as Record<string, ExchangeCtor | undefined>)[id];
    if (!Ctor) throw new Error(`Unknown exchange: ${id}`);
    exchanges.set(id, new Ctor({ enableRateLimit: true, timeout: FETCH_TIMEOUT_MS }));
  }
  return exchanges.get(id)!;
}

/**
 * Fetch OHLCV candles from a single source.
 */
export async function fetchCandles(
  exchange: string,
  symbol: string,
  since: number,
  limit = OHLC_FETCH_LIMIT,
): Promise<Candle[]> {
  const ex = getExchange(exchange);
  const raw = await ex.fetchOHLCV(symbol, TF, since, limit);
  return raw.map((bar) => ({
    ts: Number(bar[0]),
    o: Number(bar[1]),
    h: Number(bar[2]),
    l: Number(bar[3]),
    c: Number(bar[4]),
    v: Number(bar[5]),
  }));
}

/**
 * Merge candles from multiple weighted sources.
 * O/C are weighted averages, H is max, L is min, V is summed.
 */
export function mergeWeightedCandles(
  sourceResults: { candles: Candle[]; weight: number }[],
): Candle[] {
  const byTs = new Map<
    number,
    { totalW: number; o: number; h: number; l: number; c: number; v: number }
  >();

  for (const { candles, weight } of sourceResults) {
    for (const c of candles) {
      const ts = Math.floor(c.ts / TF_MS) * TF_MS; // align to 1m
      const existing = byTs.get(ts);
      if (!existing) {
        // H/L stored as raw values (not weighted), V summed
        byTs.set(ts, { totalW: weight, o: c.o * weight, h: c.h, l: c.l, c: c.c * weight, v: c.v });
      } else {
        existing.totalW += weight;
        existing.o += c.o * weight;
        existing.h = Math.max(existing.h, c.h);
        existing.l = Math.min(existing.l, c.l);
        existing.c += c.c * weight;
        existing.v += c.v;
      }
    }
  }

  // Normalize O/C by weight; H/L/V are already correct
  const candles: Candle[] = [];
  for (const [ts, d] of byTs) {
    if (d.totalW === 0) continue;
    candles.push({
      ts,
      o: d.o / d.totalW,
      h: d.h,
      l: d.l,
      c: d.c / d.totalW,
      v: d.v,
    });
  }
  return candles.sort((a, b) => a.ts - b.ts);
}

/**
 * Fetch weighted-average M1 candles from multiple sources for a pair.
 */
async function fetchWeightedCandles(pair: string, since: number): Promise<Candle[]> {
  const sources = OHLC_SOURCES[pair];
  if (!sources?.length) {
    log.warn(`No OHLC sources configured for ${pair}`);
    return [];
  }

  // Fetch from all sources in parallel
  const results = await Promise.allSettled(
    sources.map((s) => fetchCandles(s.exchange, s.symbol, since)),
  );

  const sourceResults: { candles: Candle[]; weight: number }[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status !== "fulfilled") {
      log.warn(`OHLC source ${sources[i].exchange}:${sources[i].symbol} failed`);
      continue;
    }
    sourceResults.push({ candles: r.value, weight: sources[i].weight });
  }

  return mergeWeightedCandles(sourceResults);
}

/**
 * Backfill historical M1 data on startup (30 days).
 * Returns accumulated candles for the in-memory buffer.
 */
export async function backfill(store: DragonflyStore, pair: string): Promise<Candle[]> {
  const latestTs = await store.getLatestCandleTs();
  const now = Date.now();
  const since = latestTs > 0 ? latestTs + TF_MS : now - BACKFILL_MS;

  if (since >= now - TF_MS) {
    log.info(`${pair} OHLC up to date`);
    return [];
  }

  log.info(`Backfilling ${pair} M1 OHLC from ${new Date(since).toISOString()}`);

  const allCandles: Candle[] = [];
  let cursor = since;
  let total = 0;
  for (let iter = 0; iter < OHLC_MAX_ITERATIONS && cursor < now; iter++) {
    const candles = await fetchWeightedCandles(pair, cursor);
    if (!candles.length) break;
    ingestToO2(
      "candles",
      candles.map((c) => ({ pair, ...c })),
    );
    allCandles.push(...candles);
    total += candles.length;
    const lastTs = candles[candles.length - 1].ts;
    if (lastTs + TF_MS <= cursor) break; // prevent stuck cursor
    cursor = lastTs + TF_MS;
    log.debug(`${pair}: backfilled ${total} M1 candles`);
  }

  // Persist cursor for restart resume
  if (allCandles.length) {
    await store.setLatestCandleTs(allCandles[allCandles.length - 1].ts);
  }

  log.info(`${pair}: backfilled ${total} M1 candles`);
  return allCandles;
}

/**
 * Fetch the latest M1 candle(s) since last stored.
 * Returns new candles for the in-memory buffer.
 */
export async function fetchLatestM1(store: DragonflyStore, pair: string): Promise<Candle[]> {
  const latestTs = await store.getLatestCandleTs();
  const since = latestTs > 0 ? latestTs : Date.now() - TF_MS * OHLC_LATEST_LOOKBACK_CANDLES;
  const candles = await fetchWeightedCandles(pair, since);
  if (candles.length) {
    ingestToO2(
      "candles",
      candles.map((c) => ({ pair, ...c })),
    );
    await store.setLatestCandleTs(candles[candles.length - 1].ts);
  }
  return candles;
}
