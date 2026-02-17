import type { PoolSnapshot, PoolAnalysis, Forces, PoolConfig } from "../types";
import { intervalVolume } from "../data/gecko";
import { computeRange } from "./range";
import { SECONDS_PER_YEAR, DEFAULT_FEE } from "../config/params";
import { log, pct, usd } from "../utils";

/**
 * Compute pool analyses for all pools.
 * Pure function: receives snapshots + forces + previous snapshots, returns PoolAnalysis[].
 * No side effects — no internal fetching.
 */
export function computePoolAnalyses(
  snapshots: PoolSnapshot[],
  prevSnapshots: Map<string, PoolSnapshot | null>,
  pools: PoolConfig[],
  forces: Forces,
  intervalSec: number,
  now: number,
): PoolAnalysis[] {
  const analyses: PoolAnalysis[] = [];
  const price = snapshots[0]?.exchangeRate || 1;
  const range = computeRange(price, forces);

  for (const snap of snapshots) {
    const key = `${snap.chain}:${snap.pool}`;
    const prev = prevSnapshots.get(key) ?? null;

    // Use GeckoTerminal fee_pct as primary source; fallback fee from on-chain is demoted
    const feePct = snap.feePct || DEFAULT_FEE;

    const volume = intervalVolume(snap, prev, intervalSec);
    const feesGenerated = volume * feePct;
    const tvl = snap.tvl || 1; // avoid div/0
    const utilization = feesGenerated / tvl;
    const apr = utilization * (SECONDS_PER_YEAR / intervalSec);

    analyses.push({
      pool: snap.pool,
      chain: snap.chain,
      ts: now,
      intervalVolume: volume,
      feePct,
      feesGenerated,
      tvl,
      utilization,
      apr,
      exchangeRate: snap.exchangeRate,
      basePriceUsd: snap.basePriceUsd,
      vforce: forces.v.force,
      mforce: forces.m.force,
      tforce: forces.t.force,
      rangeMin: range.min,
      rangeMax: range.max,
      rangeBreadth: range.breadth,
      rangeBias: range.trendBias,
      rangeConfidence: range.confidence,
    });

    log.debug(`${key}: vol=${usd(volume)} fee=${pct(feePct)} tvl=${usd(tvl)} apr=${pct(apr)}`);
  }

  return analyses.sort((a, b) => b.apr - a.apr);
}
