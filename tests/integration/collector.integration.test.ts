/**
 * Integration: collector ↔ strategy runner data flow via DragonflyDB.
 * Tests real Redis read/write of shared candle + snapshot data.
 */
import { describe, expect, test, afterAll } from "bun:test";
import { RedisClient } from "bun";
import {
  KEYS,
  writeCollectedCandles,
  readCollectedCandles,
  writeCollectedSnapshots,
  readCollectedSnapshots,
  writeCollectedTs,
  readCollectedTs,
  addConfigCollectorPair,
  getConfigCollectorPairIds,
  removeConfigCollectorPair,
  setCollectorState,
  getCollectorState,
} from "../../src/infra/redis";
import type { Candle, PoolSnapshot } from "../../src/types";
import type { CollectorState } from "../../src/state";

let redisAvailable = false;
let redis: RedisClient | null = null;
try {
  const r = new RedisClient("redis://localhost:6379");
  const ping = (await Promise.race([
    r.ping(),
    new Promise<null>((_, rj) => setTimeout(() => rj(null), 500)),
  ])) as string | null;
  if (ping === "PONG") {
    redisAvailable = true;
    redis = r;
  } else {
    r.close();
  }
} catch {}

afterAll(() => redis?.close());

const TEST_PAIR = `TEST-COLL-${Date.now()}`;

describe.skipIf(!redisAvailable)("Collector: shared data read/write", () => {
  test("write and read candles", async () => {
    const candles: Candle[] = [
      { ts: 1000, o: 1.0, h: 1.01, l: 0.99, c: 1.005, v: 500 },
      { ts: 2000, o: 1.005, h: 1.02, l: 0.99, c: 1.01, v: 600 },
    ];

    await writeCollectedCandles(redis!, TEST_PAIR, candles);
    const read = await readCollectedCandles(redis!, TEST_PAIR);

    expect(read).toHaveLength(2);
    expect(read[0].ts).toBe(1000);
    expect(read[1].c).toBe(1.01);

    // Cleanup
    await redis!.del(KEYS.dataCandles(TEST_PAIR));
  });

  test("write and read snapshots", async () => {
    const snapshots: PoolSnapshot[] = [
      {
        pool: "0x0000000000000000000000000000000000000001",
        chain: 1,
        ts: Date.now(),
        volume24h: 100000,
        tvl: 5000000,
        feePct: 0.0005,
        basePriceUsd: 1.0,
        quotePriceUsd: 1.0,
        exchangeRate: 1.0,
        priceChangeH1: 0,
        priceChangeH24: 0,
      },
    ];

    await writeCollectedSnapshots(redis!, TEST_PAIR, snapshots);
    const read = await readCollectedSnapshots(redis!, TEST_PAIR);

    expect(read).toHaveLength(1);
    expect(read[0].tvl).toBe(5000000);
    expect(read[0].feePct).toBe(0.0005);

    await redis!.del(KEYS.dataSnapshots(TEST_PAIR));
  });

  test("write and read collection timestamp", async () => {
    const ts = Date.now();
    await writeCollectedTs(redis!, TEST_PAIR, ts);
    const read = await readCollectedTs(redis!, TEST_PAIR);
    expect(read).toBe(ts);

    await redis!.del(KEYS.dataTs(TEST_PAIR));
  });

  test("empty candles/snapshots return empty arrays", async () => {
    const candles = await readCollectedCandles(redis!, "NONEXISTENT-PAIR");
    const snapshots = await readCollectedSnapshots(redis!, "NONEXISTENT-PAIR");
    expect(candles).toEqual([]);
    expect(snapshots).toEqual([]);
  });

  test("missing timestamp returns 0", async () => {
    const ts = await readCollectedTs(redis!, "NONEXISTENT-PAIR");
    expect(ts).toBe(0);
  });

  test("write empty candles is a no-op", async () => {
    await writeCollectedCandles(redis!, TEST_PAIR, []);
    const read = await readCollectedCandles(redis!, TEST_PAIR);
    expect(read).toEqual([]);
  });
});

describe.skipIf(!redisAvailable)("Collector: config", () => {
  test("add and list collector pairs", async () => {
    await addConfigCollectorPair(redis!, TEST_PAIR);
    const ids = await getConfigCollectorPairIds(redis!);
    expect(ids).toContain(TEST_PAIR);

    await removeConfigCollectorPair(redis!, TEST_PAIR);
    const after = await getConfigCollectorPairIds(redis!);
    expect(after).not.toContain(TEST_PAIR);
  });
});

describe.skipIf(!redisAvailable)("Collector: state persistence", () => {
  test("set and get collector state", async () => {
    const state: CollectorState = {
      pairId: TEST_PAIR,
      pid: 99999,
      status: "running",
      uptimeMs: 30000,
      lastCollectTs: Date.now(),
      candleCount: 42,
      snapshotCount: 3,
    };

    await setCollectorState(redis!, TEST_PAIR, state);
    const read = await getCollectorState(redis!, TEST_PAIR);

    expect(read).not.toBeNull();
    expect(read!.pairId).toBe(TEST_PAIR);
    expect(read!.status).toBe("running");
    expect(read!.candleCount).toBe(42);

    await redis!.del(KEYS.collectorState(TEST_PAIR));
  });

  test("missing collector state returns null", async () => {
    const state = await getCollectorState(redis!, "NONEXISTENT-PAIR");
    expect(state).toBeNull();
  });
});
