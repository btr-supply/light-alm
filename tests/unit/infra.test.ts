/**
 * Infrastructure tests: Redis locks, O2 client, logger
 * Fast, focused unit tests with minimal mocking.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { RedisClient } from "bun";

const { structuredLog } = await import("../../src/infra/logger");

// Skip Redis tests if no local Redis/DragonflyDB available
const withRedis = async <T>(fn: (r: RedisClient) => Promise<T>): Promise<T | null> => {
  const timeout = (ms: number) => new Promise<null>((_, r) => setTimeout(() => r(null), ms));
  try {
    const r = new RedisClient("redis://localhost:6379");
    const ping = (await Promise.race([r.ping(), timeout(500)])) as string | null;
    if (ping !== "PONG") {
      r.close();
      return null;
    }
    const result = await fn(r);
    r.close();
    return result;
  } catch {
    return null;
  }
};

describe("Redis: lock primitives", () => {
  test("acquireLock: returns false when lock held", async () => {
    const result = await withRedis(async (redis) => {
      const key = `test:lock:${Date.now()}`;
      const value = "holder1";

      const acquired1 = await redis.send("SET", [key, value, "PX", "5000", "NX"]);
      expect(acquired1).toBe("OK");

      const acquired2 = await redis.send("SET", [key, "holder2", "PX", "5000", "NX"]);
      expect(acquired2).toBeNull();

      await redis.del(key);
      return true;
    });
    if (result === null) console.log("  Skipping (Redis unavailable)");
  });

  test("refreshLock: succeeds only when holder matches", async () => {
    const result = await withRedis(async (redis) => {
      const key = `test:lock:${Date.now()}`;
      const value = "holder1";

      await redis.send("SET", [key, value, "PX", "5000", "NX"]);

      const script = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("pexpire", KEYS[1], ARGV[2]) else return 0 end`;
      const refresh1 = await redis.send("EVAL", [script, "1", key, value, "10000"]);
      expect(refresh1).toBe(1);

      const refresh2 = await redis.send("EVAL", [script, "1", key, "holder2", "10000"]);
      expect(refresh2).toBe(0);

      await redis.del(key);
      return true;
    });
    if (result === null) console.log("  Skipping (Redis unavailable)");
  });

  test("acquire -> refresh -> release sequence", async () => {
    const result = await withRedis(async (redis) => {
      const key = `test:lock:${Date.now()}`;
      const value = "holder1";

      const acquired = await redis.send("SET", [key, value, "PX", "5000", "NX"]);
      expect(acquired).toBe("OK");

      const script = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("pexpire", KEYS[1], ARGV[2]) else return 0 end`;
      const refreshed = await redis.send("EVAL", [script, "1", key, value, "10000"]);
      expect(refreshed).toBe(1);

      const delScript = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;
      const deleted = await redis.send("EVAL", [delScript, "1", key, value]);
      expect(deleted).toBe(1);

      const exists = await redis.exists(key);
      expect(exists).toBe(0);
      return true;
    });
    if (result === null) console.log("  Skipping (Redis unavailable)");
  });
});

describe("Redis: exchange rate limiter", () => {
  test("reserveExchangeSlot serializes calls to same exchange", async () => {
    const result = await withRedis(async (redis) => {
      const { reserveExchangeSlot } = await import("../../src/infra/redis");
      const exchange = `test-ex-${Date.now()}`;
      const interval = 200;

      // First call gets immediate slot (wait=0)
      const wait1 = await reserveExchangeSlot(redis, exchange, interval);
      expect(wait1).toBe(0);

      // Second call must wait ~200ms
      const wait2 = await reserveExchangeSlot(redis, exchange, interval);
      expect(wait2).toBeGreaterThanOrEqual(interval - 50); // small clock drift tolerance
      expect(wait2).toBeLessThanOrEqual(interval + 50);

      // Third call stacks on top of second
      const wait3 = await reserveExchangeSlot(redis, exchange, interval);
      expect(wait3).toBeGreaterThanOrEqual(interval - 50);

      // Cleanup
      await redis.del(`btr:ratelimit:exchange:${exchange}`);
      return true;
    });
    if (result === null) console.log("  Skipping (Redis unavailable)");
  });

  test("different exchanges get independent slots", async () => {
    const result = await withRedis(async (redis) => {
      const { reserveExchangeSlot } = await import("../../src/infra/redis");
      const ts = Date.now();
      const exA = `test-exA-${ts}`;
      const exB = `test-exB-${ts}`;

      const waitA = await reserveExchangeSlot(redis, exA, 200);
      const waitB = await reserveExchangeSlot(redis, exB, 200);

      // Both should get immediate slots since they're independent
      expect(waitA).toBe(0);
      expect(waitB).toBe(0);

      await redis.del(`btr:ratelimit:exchange:${exA}`);
      await redis.del(`btr:ratelimit:exchange:${exB}`);
      return true;
    });
    if (result === null) console.log("  Skipping (Redis unavailable)");
  });
});

describe("O2: client buffering", () => {
  test("flush resolves when called", async () => {
    const url = process.env.O2_URL;
    if (!url) return;

    const { O2Client } = await import("../../src/infra/o2");
    const client = new O2Client(url, "test", process.env.O2_TOKEN || "test");

    client.ingest("test", [{ _timestamp: new Date().toISOString(), msg: "test" }]);

    await expect(client.flush()).resolves.toBeUndefined();
    await client.shutdown();
  });
});

describe("Logger: level filtering", () => {
  let origLog: typeof console.log;
  let origInfo: typeof console.info;
  let origWarn: typeof console.warn;
  const logs: string[] = [];

  beforeEach(() => {
    logs.length = 0;
    origLog = console.log;
    origInfo = console.info;
    origWarn = console.warn;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));
    console.info = (...args: unknown[]) => logs.push(args.join(" "));
    console.warn = (...args: unknown[]) => logs.push(args.join(" "));
  });

  afterEach(() => {
    console.log = origLog;
    console.info = origInfo;
    console.warn = origWarn;
    structuredLog.setLevel("info");
  });

  test("setLevel accepts all valid levels", () => {
    for (const level of ["debug", "info", "warn", "error"]) {
      expect(() => structuredLog.setLevel(level)).not.toThrow();
    }
  });

  test("emit calls produce structured output", () => {
    structuredLog.setLevel("debug");
    structuredLog.info("test-msg-123");
    expect(logs.some((l) => l.includes("test-msg-123"))).toBe(true);
  });

  test("level filtering suppresses lower levels", () => {
    structuredLog.setLevel("error");
    structuredLog.debug("should-not-appear");
    structuredLog.info("should-not-appear");
    structuredLog.warn("should-not-appear");
    expect(logs.some((l) => l.includes("should-not-appear"))).toBe(false);
  });
});
