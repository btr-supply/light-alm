import { describe, expect, test } from "bun:test";
import {
  retry,
  withFallback,
  RateLimiter,
  sortTokens,
  sortTokensWithAmounts,
} from "../../src/utils";
import { silenceLog } from "../helpers";

silenceLog();

// ---- M1: retry() ----

describe("retry — extended coverage", () => {
  test("returns result immediately when fn succeeds first try", async () => {
    const result = await retry(async () => "first-try", 3, 1);
    expect(result).toBe("first-try");
  });

  test("retries N times then succeeds on attempt N+1", async () => {
    let attempt = 0;
    const result = await retry(
      async () => {
        attempt++;
        if (attempt <= 2) throw new Error(`fail-${attempt}`);
        return attempt;
      },
      3,
      1,
    );
    expect(result).toBe(3);
    expect(attempt).toBe(3);
  });

  test("propagates original error after exhausting retries", async () => {
    const err = new TypeError("custom-type-error");
    try {
      await retry(
        async () => {
          throw err;
        },
        2,
        1,
      );
      expect(true).toBe(false); // should not reach
    } catch (e) {
      expect(e).toBe(err);
      expect((e as TypeError).message).toBe("custom-type-error");
    }
  });

  test("backoff delays increase exponentially", async () => {
    const timestamps: number[] = [];
    let attempt = 0;
    const backoffBase = 50;
    await retry(
      async () => {
        timestamps.push(Date.now());
        attempt++;
        if (attempt <= 2) throw new Error("transient");
        return "done";
      },
      2,
      backoffBase,
    );

    // Between attempt 1 and 2: ~50ms delay (backoffBase * 2^0)
    // Between attempt 2 and 3: ~100ms delay (backoffBase * 2^1)
    const gap1 = timestamps[1] - timestamps[0];
    const gap2 = timestamps[2] - timestamps[1];
    expect(gap1).toBeGreaterThanOrEqual(40);
    expect(gap2).toBeGreaterThanOrEqual(80);
    expect(gap2).toBeGreaterThan(gap1);
  });

  test("maxRetries=0 means single attempt, no retries", async () => {
    let attempt = 0;
    await expect(
      retry(
        async () => {
          attempt++;
          throw new Error("fail");
        },
        0,
        1,
      ),
    ).rejects.toThrow("fail");
    expect(attempt).toBe(1);
  });

  test("preserves async return type", async () => {
    const obj = await retry(async () => ({ key: "value", num: 42 }), 1, 1);
    expect(obj.key).toBe("value");
    expect(obj.num).toBe(42);
  });
});

// ---- M2: withFallback() ----

describe("withFallback — extended coverage", () => {
  test("returns successful result without using fallback", async () => {
    const result = await withFallback(async () => "success", "fallback", "ctx");
    expect(result).toBe("success");
  });

  test("returns fallback value when fn throws", async () => {
    const result = await withFallback(
      async () => {
        throw new Error("boom");
      },
      "safe-default",
      "ctx",
    );
    expect(result).toBe("safe-default");
  });

  test("preserves complex return types", async () => {
    const fallback = { items: [] as number[], count: 0 };
    const result = await withFallback(
      async () => ({ items: [1, 2, 3], count: 3 }),
      fallback,
      "ctx",
    );
    expect(result.items).toEqual([1, 2, 3]);
    expect(result.count).toBe(3);
  });

  test("returns fallback for rejected promises", async () => {
    const result = await withFallback(() => Promise.reject(new Error("rejected")), -1, "ctx");
    expect(result).toBe(-1);
  });

  test("fallback of same type as success path", async () => {
    const result = await withFallback(async () => 100, 0, "ctx");
    expect(typeof result).toBe("number");
    expect(result).toBe(100);

    const fallbackResult = await withFallback(
      async (): Promise<number> => {
        throw new Error("err");
      },
      0,
      "ctx",
    );
    expect(typeof fallbackResult).toBe("number");
    expect(fallbackResult).toBe(0);
  });
});

// ---- M3: RateLimiter ----

describe("RateLimiter — extended coverage", () => {
  test("serializes sequential calls (second waits for first)", async () => {
    const limiter = new RateLimiter(60);
    const order: number[] = [];

    const p1 = limiter.wait().then(() => order.push(1));
    const p2 = limiter.wait().then(() => order.push(2));
    await Promise.all([p1, p2]);

    expect(order).toEqual([1, 2]);
  });

  test("zero-interval limiter executes without delay", async () => {
    const limiter = new RateLimiter(0);
    const start = Date.now();
    await limiter.wait();
    await limiter.wait();
    await limiter.wait();
    const elapsed = Date.now() - start;
    // With 0 interval, should be very fast (allow for scheduling jitter)
    expect(elapsed).toBeLessThan(500);
  });

  test("multiple queued calls execute in FIFO order", async () => {
    const limiter = new RateLimiter(20);
    const order: number[] = [];

    const promises = [1, 2, 3, 4].map((n) => limiter.wait().then(() => order.push(n)));
    await Promise.all(promises);

    expect(order).toEqual([1, 2, 3, 4]);
  });

  test("respects minimum interval between consecutive calls", async () => {
    const interval = 80;
    const limiter = new RateLimiter(interval);
    const timestamps: number[] = [];

    await limiter.wait();
    timestamps.push(Date.now());
    await limiter.wait();
    timestamps.push(Date.now());

    const gap = timestamps[1] - timestamps[0];
    // Should wait at least ~interval ms (minus some scheduling variance)
    expect(gap).toBeGreaterThanOrEqual(interval - 10);
  });
});

// ---- M4: sortTokens() and sortTokensWithAmounts() ----

describe("sortTokens — extended coverage", () => {
  test("already-sorted tokens pass through unchanged", () => {
    const lo = "0x1111111111111111111111111111111111111111" as `0x${string}`;
    const hi = "0x9999999999999999999999999999999999999999" as `0x${string}`;
    const [a, b] = sortTokens(lo, hi);
    expect(a).toBe(lo);
    expect(b).toBe(hi);
  });

  test("unsorted tokens get swapped", () => {
    const lo = "0x1111111111111111111111111111111111111111" as `0x${string}`;
    const hi = "0x9999999999999999999999999999999999999999" as `0x${string}`;
    const [a, b] = sortTokens(hi, lo);
    expect(a).toBe(lo);
    expect(b).toBe(hi);
  });

  test("case-insensitive: mixed-case addresses sort correctly", () => {
    const upper = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" as `0x${string}`;
    const lower = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as `0x${string}`;
    const [a, b] = sortTokens(upper, lower);
    expect(a.toLowerCase()).toBe(upper.toLowerCase());
    expect(b.toLowerCase()).toBe(lower.toLowerCase());
  });

  test("idempotent: sorting twice yields same result", () => {
    const x = "0xdead000000000000000000000000000000000000" as `0x${string}`;
    const y = "0xbeef000000000000000000000000000000000000" as `0x${string}`;
    const [a1, b1] = sortTokens(x, y);
    const [a2, b2] = sortTokens(a1, b1);
    expect(a1).toBe(a2);
    expect(b1).toBe(b2);
  });

  test("equal addresses pass through", () => {
    const addr = "0xaaaa000000000000000000000000000000000000" as `0x${string}`;
    const [a, b] = sortTokens(addr, addr);
    expect(a).toBe(addr);
    expect(b).toBe(addr);
  });
});

describe("sortTokensWithAmounts — extended coverage", () => {
  test("already-sorted: tokens and amounts unchanged", () => {
    const lo = "0x1111111111111111111111111111111111111111" as `0x${string}`;
    const hi = "0x9999999999999999999999999999999999999999" as `0x${string}`;
    const { tokens, amounts } = sortTokensWithAmounts(lo, hi, 100n, 200n);
    expect(tokens).toEqual([lo, hi]);
    expect(amounts).toEqual([100n, 200n]);
  });

  test("unsorted: both tokens AND amounts get swapped together", () => {
    const lo = "0x1111111111111111111111111111111111111111" as `0x${string}`;
    const hi = "0x9999999999999999999999999999999999999999" as `0x${string}`;
    const { tokens, amounts } = sortTokensWithAmounts(hi, lo, 300n, 700n);
    expect(tokens).toEqual([lo, hi]);
    expect(amounts).toEqual([700n, 300n]);
  });

  test("case-insensitive hex address comparison", () => {
    const upper = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" as `0x${string}`;
    const lower = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as `0x${string}`;
    const { tokens, amounts } = sortTokensWithAmounts(lower, upper, 50n, 150n);
    // "0xaaaa..." < "0xbbbb..." so upper comes first
    expect(tokens[0].toLowerCase()).toBe(upper.toLowerCase());
    expect(tokens[1].toLowerCase()).toBe(lower.toLowerCase());
    expect(amounts).toEqual([150n, 50n]);
  });

  test("zero amounts are swapped correctly", () => {
    const lo = "0x1111111111111111111111111111111111111111" as `0x${string}`;
    const hi = "0x9999999999999999999999999999999999999999" as `0x${string}`;
    const { tokens, amounts } = sortTokensWithAmounts(hi, lo, 0n, 500n);
    expect(tokens).toEqual([lo, hi]);
    expect(amounts).toEqual([500n, 0n]);
  });
});
