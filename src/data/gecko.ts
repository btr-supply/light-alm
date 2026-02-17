import type { PoolConfig, PoolSnapshot, GeckoPoolData } from "../types";
import { geckoNetwork } from "../config/chains";
import { ingestToO2 } from "../infra/o2";
import {
  GECKO_API_BASE,
  GECKO_RATE_LIMIT_MS,
  SECONDS_PER_DAY,
  FETCH_TIMEOUT_MS,
} from "../config/params";
import { log, RateLimiter, retry } from "../utils";

const limiter = new RateLimiter(GECKO_RATE_LIMIT_MS);

interface GeckoPoolAttrs {
  reserve_in_usd: string;
  volume_usd: { h24: string };
  base_token_price_usd: string;
  quote_token_price_usd: string;
  base_token_price_quote_token: string;
  pool_fee_percentage: string | null;
  price_change_percentage: { h1: string; h24: string };
}

/**
 * Fetch enriched pool data from GeckoTerminal.
 */
export async function fetchPool(network: string, address: string): Promise<GeckoPoolData> {
  await limiter.wait();
  const url = `${GECKO_API_BASE}/networks/${network}/pools/${address}`;
  const res = await retry(() =>
    fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }),
  );
  if (!res.ok) throw new Error(`Gecko ${res.status}: ${url}`);
  const json = (await res.json()) as { data: { attributes: GeckoPoolAttrs } };
  const attrs = json.data.attributes;
  const feePctRaw = parseFloat(attrs.pool_fee_percentage ?? "0");
  return {
    volume24h: parseFloat(attrs.volume_usd.h24) || 0,
    tvl: parseFloat(attrs.reserve_in_usd) || 0,
    feePct: feePctRaw > 0 ? feePctRaw / 100 : 0, // convert percentage to decimal
    basePriceUsd: parseFloat(attrs.base_token_price_usd) || 0,
    quotePriceUsd: parseFloat(attrs.quote_token_price_usd) || 0,
    exchangeRate: parseFloat(attrs.base_token_price_quote_token) || 0,
    priceChangeH1: parseFloat(attrs.price_change_percentage?.h1) || 0,
    priceChangeH24: parseFloat(attrs.price_change_percentage?.h24) || 0,
  };
}

/**
 * Fetch enriched snapshots for all pools of a pair.
 * Snapshots are ingested to O2 for persistence.
 */
export async function fetchPoolSnapshots(
  pairId: string,
  pools: PoolConfig[],
  now = Date.now(),
): Promise<PoolSnapshot[]> {
  const settled = await Promise.allSettled(
    pools.map(async (pool) => {
      const data = await fetchPool(geckoNetwork(pool.chain), pool.address);
      const snapshot: PoolSnapshot = {
        pool: pool.address,
        chain: pool.chain,
        ts: now,
        ...data,
      };
      return snapshot;
    }),
  );

  const results: PoolSnapshot[] = [];
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    if (r.status === "fulfilled") {
      results.push(r.value);
    } else {
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      log.warn(`Gecko fetch failed for ${pools[i].address} on chain ${pools[i].chain}: ${msg}`);
    }
  }

  // Ingest all snapshots to O2
  if (results.length) {
    ingestToO2(
      "pool_snapshots",
      results.map((s) => ({ pairId, ...s })),
    );
  }

  return results;
}

/**
 * Calculate interval volume by diffing consecutive 24h snapshots.
 */
export function intervalVolume(
  current: PoolSnapshot,
  previous: PoolSnapshot | null,
  intervalSec: number,
): number {
  if (!previous) return current.volume24h / (SECONDS_PER_DAY / intervalSec);
  const diff = current.volume24h - previous.volume24h;
  // If negative (24h window rolled), fallback to proportional estimate
  if (diff < 0) return current.volume24h / (SECONDS_PER_DAY / intervalSec);
  return diff;
}
