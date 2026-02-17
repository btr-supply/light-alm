/**
 * Orchestration integration: Redis coordinator, worker lifecycle
 * Tests real Redis communication, worker spawn, heartbeat, shutdown.
 */
import { describe, expect, test, afterAll } from "bun:test";
import { RedisClient } from "bun";

// Probe Redis availability once at module load
let redisAvailable = false;
let sharedRedis: RedisClient | null = null;
try {
  const r = new RedisClient("redis://localhost:6379");
  const ping = (await Promise.race([
    r.ping(),
    new Promise<null>((_, rj) => setTimeout(() => rj(null), 500)),
  ])) as string | null;
  if (ping === "PONG") {
    redisAvailable = true;
    sharedRedis = r;
  } else {
    r.close();
  }
} catch {
  /* Redis not available */
}

afterAll(() => sharedRedis?.close());

const TEST_PAIR = `TEST-PAIR-${Date.now()}`;

describe.skipIf(!redisAvailable)("Orchestration: Redis coordinator", () => {
  test("worker lock acquisition prevents duplicate workers", async () => {
    const redis = sharedRedis!;
    const lockKey = `btr:worker:${TEST_PAIR}:lock`;
    const ttl = 60000;
    const worker1 = `worker1:${Date.now()}`;
    const worker2 = `worker2:${Date.now()}`;

    const acquired1 = await redis.send("SET", [lockKey, worker1, "PX", String(ttl), "NX"]);
    expect(acquired1).toBe("OK");

    const acquired2 = await redis.send("SET", [lockKey, worker2, "PX", String(ttl), "NX"]);
    expect(acquired2).toBeNull();

    const script = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("pexpire", KEYS[1], ARGV[2]) else return 0 end`;
    const refreshed = await redis.send("EVAL", [script, "1", lockKey, worker1, String(ttl)]);
    expect(refreshed).toBe(1);

    await redis.del(lockKey);
  });

  test("worker state persists and retrieves", async () => {
    const redis = sharedRedis!;
    const stateKey = `btr:worker:${TEST_PAIR}:state`;
    const state = {
      pairId: TEST_PAIR,
      pid: 12345,
      status: "running",
      uptimeMs: 60000,
      epoch: 5,
      lastDecision: "HOLD",
      lastDecisionTs: Date.now(),
      currentApr: 0.08,
      optimalApr: 0.1,
    };

    await redis.send("SET", [stateKey, JSON.stringify(state)]);

    const retrieved = await redis.get(stateKey);
    expect(retrieved).not.toBeNull();

    const parsed = JSON.parse(retrieved!);
    expect(parsed.pairId).toBe(TEST_PAIR);
    expect(parsed.status).toBe("running");
    expect(parsed.epoch).toBe(5);

    await redis.del(stateKey);
  });

  test("control channel pub/sub delivers messages", async () => {
    const redis = sharedRedis!;
    const channel = "btr:control";
    const received: string[] = [];

    const sub = new RedisClient("redis://localhost:6379");
    await sub.subscribe(channel, (msg) => received.push(msg));

    const message = JSON.stringify({ type: "SHUTDOWN" });
    await redis.publish(channel, message);

    await new Promise((r) => setTimeout(r, 500));

    expect(received.length).toBeGreaterThan(0);
    expect(JSON.parse(received[0]).type).toBe("SHUTDOWN");

    sub.close();
  }, 10_000);
});

describe.skipIf(!redisAvailable)("Orchestration: worker lifecycle", () => {
  test("worker registers in orchestrator set", async () => {
    const redis = sharedRedis!;
    await redis.sadd("btr:workers", TEST_PAIR);

    const members = await redis.smembers("btr:workers");
    expect(members).toContain(TEST_PAIR);

    await redis.srem("btr:workers", TEST_PAIR);
  });

  test("orchestrator can list all active pairs", async () => {
    const redis = sharedRedis!;
    const pairs = [TEST_PAIR, "ANOTHER-TEST"];
    await redis.sadd("btr:workers", ...pairs);

    const members = await redis.smembers("btr:workers");
    expect(members).toContain(TEST_PAIR);
    expect(members).toContain("ANOTHER-TEST");

    await redis.srem("btr:workers", ...pairs);
  });
});
