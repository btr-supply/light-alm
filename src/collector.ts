/**
 * Collector worker — fetches market (OHLC) and pool (GeckoTerminal) data for a token pair.
 * One collector per pair (singleton). Strategy runners read its output from shared DragonflyDB keys.
 */
import { DragonflyStore } from "./data/store-dragonfly";
import { fetchLatestM1, backfill, trimCandles, setOhlcRedis } from "./data/ohlc";
import { fetchPoolSnapshots } from "./data/gecko";
import { CANDLE_BUFFER_MS, WORKER_HEARTBEAT_TTL, DEFAULT_FORCE_PARAMS, HOUR_MS, MTF_CANDLES, M15_MS, H1_MS, H4_MS } from "./config/params";
import { aggregateCandles } from "../shared/format";
import { computeForces, blendForces } from "./strategy/forces";
import { computeRange } from "./strategy/range";
import { ingestToO2, flushO2 } from "./infra/o2";
import { getPoolAnalysesByPair } from "./data/store-o2";
import { log, errMsg, upperBound } from "./utils";
import { toCollectorState } from "./state";
import type { Candle } from "./types";
import {
  KEYS,
  setCollectorState,
  writeCollectedCandles,
  writeCollectedSnapshots,
  writeCollectedTs,
} from "./infra/redis";
import {
  bootstrapWorker,
  startHeartbeat,
  subscribeControl,
  cleanupWorker,
  loadWorkerPairConfig,
} from "./worker-base";

const ctx = await bootstrapWorker("collector", 2, "COLLECTOR_PAIR_ID", (pairId) => ({
  lock: KEYS.collectorLock(pairId),
  heartbeat: KEYS.collectorHeartbeat(pairId),
  restarting: KEYS.collectorRestarting(pairId),
}));

const { pairId, redis, startTs } = ctx;
const pair = await loadWorkerPairConfig(redis, pairId, `Collector ${pairId}`);

setOhlcRedis(redis);
const store = new DragonflyStore(redis, pairId);
let candles: Candle[] = [];
let lastCollectTs = 0;
let lastSnapshotCount = 0;
let collectTimer: ReturnType<typeof setTimeout> | null = null;
let sub: Awaited<ReturnType<typeof subscribeControl>> | null = null;
let heartbeatInterval: ReturnType<typeof setInterval>;
let shutdownCalled = false;

async function shutdown() {
  if (shutdownCalled) return;
  shutdownCalled = true;
  log.info(`Collector ${pairId} shutting down...`, { pairId });
  clearInterval(heartbeatInterval);
  if (collectTimer) clearTimeout(collectTimer);

  try {
    await setCollectorState(
      redis,
      pairId,
      toCollectorState(
        pairId,
        process.pid,
        startTs,
        "stopped",
        lastCollectTs,
        candles.length,
        lastSnapshotCount,
      ),
    );
  } catch {
    /* best-effort */
  }

  await cleanupWorker(ctx, sub);
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Heartbeat publishes collector state
heartbeatInterval = startHeartbeat(ctx, async () => {
  await setCollectorState(
    redis,
    pairId,
    toCollectorState(
      pairId,
      process.pid,
      startTs,
      "running",
      lastCollectTs,
      candles.length,
      lastSnapshotCount,
    ),
  );
});

await redis.set(KEYS.collectorHeartbeat(pairId), String(Date.now()), "PX", WORKER_HEARTBEAT_TTL);
sub = await subscribeControl(ctx, "RESTART_COLLECTOR", shutdown);

// Catch-up: compute forces + ranges over full backfill window at strategy cycle intervals
const INGEST_BATCH = 500;

async function catchUp() {
  if (candles.length < 10) return;
  const now = Date.now();

  // Skip if O2 already has recent pool_analyses for this pair
  const recent = await getPoolAnalysesByPair(pairId, now - 2 * HOUR_MS, now);
  if (recent.length > 0) {
    log.info(`Collector ${pairId}: catch-up skipped — ${recent.length} recent analyses in O2`);
    return;
  }

  // Pre-aggregate all timeframes once from full M1 set (O(n) total, not O(n²))
  const allM15 = aggregateCandles(candles, M15_MS);
  const allH1 = aggregateCandles(candles, H1_MS);
  const allH4 = aggregateCandles(allH1, H4_MS);

  const catchUpStart = candles[0].ts;
  // Skip steps where H4 lookback isn't satisfied (need ≥30d of M1 data behind the step)
  const minH4Ts = allH4.length >= MTF_CANDLES.h4 ? allH4[MTF_CANDLES.h4 - 1].ts : now;
  const effectiveStart = Math.max(catchUpStart, minH4Ts);

  let batch: Record<string, unknown>[] = [];
  let totalIngested = 0;

  const catchUpStep = pair!.intervalSec * 1000;
  for (let ts = effectiveStart; ts <= now; ts += catchUpStep) {
    const m15End = upperBound(allM15, ts);
    const h1End = upperBound(allH1, ts);
    const h4End = upperBound(allH4, ts);
    if (m15End < 2) continue;

    const m15Slice = allM15.slice(Math.max(0, m15End - MTF_CANDLES.m15), m15End);
    const h1Slice = allH1.slice(Math.max(0, h1End - MTF_CANDLES.h1), h1End);
    const h4Slice = allH4.slice(Math.max(0, h4End - MTF_CANDLES.h4), h4End);

    const forces = blendForces([
      computeForces(m15Slice, DEFAULT_FORCE_PARAMS),
      computeForces(h1Slice, DEFAULT_FORCE_PARAMS),
      computeForces(h4Slice, DEFAULT_FORCE_PARAMS),
    ]);
    const closingPrice = m15Slice[m15Slice.length - 1].c;
    const range = computeRange(closingPrice, forces, DEFAULT_FORCE_PARAMS);

    for (const pool of pair!.pools) {
      batch.push({
        _timestamp: new Date(ts).toISOString(),
        pool: pool.address,
        chain: pool.chain,
        ts,
        pairId,
        vforce: forces.v.force,
        mforce: forces.m.force,
        tforce: forces.t.force,
        rangeMin: range.min,
        rangeMax: range.max,
        rangeBreadth: range.breadth,
        rangeBias: range.trendBias,
        rangeConfidence: range.confidence,
        exchangeRate: closingPrice,
        basePriceUsd: 1,
        intervalVolume: 0,
        feesGenerated: 0,
        tvl: 0,
        utilization: 0,
        apr: 0,
        feePct: 0,
      });
    }

    if (batch.length >= INGEST_BATCH) {
      ingestToO2("pool_analyses", batch);
      totalIngested += batch.length;
      batch = [];
      await flushO2();
    }
  }

  if (batch.length) {
    ingestToO2("pool_analyses", batch);
    totalIngested += batch.length;
    await flushO2();
  }

  if (totalIngested) {
    log.info(`Collector ${pairId}: catch-up ingested ${totalIngested} pool_analyses records`);
  }
}

// Backfill candle buffer and write to shared keys immediately
candles = await backfill(store, pairId);
if (candles.length) {
  await writeCollectedCandles(redis, pairId, candles);
  log.info(`Collector ${pairId}: wrote ${candles.length} backfill candles to shared buffer`);
  await catchUp();
}

async function collect() {
  const now = Date.now();
  try {
    const [newCandles, snapshots] = await Promise.all([
      fetchLatestM1(store, pairId),
      fetchPoolSnapshots(pairId, pair!.pools, now),
    ]);

    if (newCandles.length) {
      candles.push(...newCandles);
      trimCandles(candles, now - CANDLE_BUFFER_MS);
    }

    await Promise.all([
      writeCollectedCandles(redis, pairId, candles),
      writeCollectedSnapshots(redis, pairId, snapshots),
      writeCollectedTs(redis, pairId, now),
    ]);

    lastCollectTs = now;
    lastSnapshotCount = snapshots.length;
    log.debug(`Collector ${pairId}: ${newCandles.length} candles, ${snapshots.length} snapshots`, {
      pairId,
    });
  } catch (e) {
    log.error(`Collector ${pairId} cycle error: ${errMsg(e)}`, { pairId });
  }
  collectTimer = setTimeout(collect, pair!.intervalSec * 1000);
}

await collect();
log.info(`Collector ${pairId} started (pid=${process.pid})`, { pairId });
