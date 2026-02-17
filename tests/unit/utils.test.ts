import { describe, expect, test } from "bun:test";
import {
  cap,
  mean,
  std,
  sma,
  rsi,
  pct,
  usd,
  retry,
  RateLimiter,
  sortTokens,
  sortTokensWithAmounts,
  withFallback,
  isValidLogLevel,
  errMsg,
} from "../../src/utils";
import { silenceLog } from "../helpers";

silenceLog();

describe("cap", () => {
  test("clamps below", () => expect(cap(-5, 0, 100)).toBe(0));
  test("clamps above", () => expect(cap(150, 0, 100)).toBe(100));
  test("passes through", () => expect(cap(50, 0, 100)).toBe(50));
  test("exact bounds", () => {
    expect(cap(0, 0, 100)).toBe(0);
    expect(cap(100, 0, 100)).toBe(100);
  });
});

describe("mean", () => {
  test("simple average", () => expect(mean([2, 4, 6])).toBe(4));
  test("single value", () => expect(mean([7])).toBe(7));
  test("negative values", () => expect(mean([-2, 2])).toBe(0));
});

describe("std", () => {
  test("zero variance", () => expect(std([5, 5, 5])).toBe(0));
  test("known variance", () => expect(std([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2, 0));
  test("single value", () => expect(std([1])).toBe(0));
});

describe("sma", () => {
  test("basic SMA", () => {
    const result = sma([1, 2, 3, 4, 5], 3);
    expect(result).toEqual([2, 3, 4]);
  });
  test("period equals length", () => {
    expect(sma([10, 20, 30], 3)).toEqual([20]);
  });
  test("period > length returns empty", () => {
    expect(sma([1, 2], 5)).toEqual([]);
  });
});

describe("rsi", () => {
  test("all gains = 100", () =>
    expect(rsi([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])).toBe(100));
  test("all losses = 0", () =>
    expect(rsi([16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1])).toBe(0));
  test("insufficient data = 50", () => expect(rsi([1, 2])).toBe(50));
  test("mixed returns between 0-100", () => {
    const v = rsi([100, 102, 101, 103, 100, 99, 101, 102, 100, 98, 99, 101, 103, 102, 100, 99]);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(100);
  });
});

describe("formatting", () => {
  test("pct", () => expect(pct(0.0534)).toBe("5.34%"));
  test("usd", () => expect(usd(1234.5)).toContain("1,234.5"));
});

describe("retry", () => {
  test("succeeds on first try", async () => {
    let callCount = 0;
    const result = await retry(
      async () => {
        callCount++;
        return 42;
      },
      3,
      1,
    );
    expect(result).toBe(42);
    expect(callCount).toBe(1);
  });

  test("retries on failure then succeeds", async () => {
    let callCount = 0;
    const result = await retry(
      async () => {
        callCount++;
        if (callCount < 3) throw new Error("transient");
        return "ok";
      },
      3,
      1,
    );
    expect(result).toBe("ok");
    expect(callCount).toBe(3);
  });

  test("throws after max retries exhausted", async () => {
    let callCount = 0;
    await expect(
      retry(
        async () => {
          callCount++;
          throw new Error("persistent");
        },
        2,
        1,
      ),
    ).rejects.toThrow("persistent");
    expect(callCount).toBe(3); // initial + 2 retries
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

    const gap1 = timestamps[1] - timestamps[0];
    const gap2 = timestamps[2] - timestamps[1];
    expect(gap1).toBeGreaterThanOrEqual(40);
    expect(gap2).toBeGreaterThanOrEqual(80);
    expect(gap2).toBeGreaterThan(gap1);
  });
});

describe("sortTokens", () => {
  test("already sorted", () => {
    const [a, b] = sortTokens("0xaaaa" as `0x${string}`, "0xbbbb" as `0x${string}`);
    expect(a).toBe("0xaaaa");
    expect(b).toBe("0xbbbb");
  });

  test("needs swap", () => {
    const [a, b] = sortTokens("0xbbbb" as `0x${string}`, "0xaaaa" as `0x${string}`);
    expect(a).toBe("0xaaaa");
    expect(b).toBe("0xbbbb");
  });

  test("case insensitive comparison", () => {
    const [a] = sortTokens("0xAAAA" as `0x${string}`, "0xbbbb" as `0x${string}`);
    expect(a.toLowerCase()).toBe("0xaaaa");
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

describe("sortTokensWithAmounts", () => {
  test("no swap when already sorted", () => {
    const { tokens, amounts } = sortTokensWithAmounts(
      "0xaaaa" as `0x${string}`,
      "0xbbbb" as `0x${string}`,
      100n,
      200n,
    );
    expect(tokens[0]).toBe("0xaaaa");
    expect(amounts[0]).toBe(100n);
    expect(amounts[1]).toBe(200n);
  });

  test("swaps amounts when tokens are reversed", () => {
    const { tokens, amounts } = sortTokensWithAmounts(
      "0xbbbb" as `0x${string}`,
      "0xaaaa" as `0x${string}`,
      100n,
      200n,
    );
    expect(tokens[0]).toBe("0xaaaa");
    expect(amounts[0]).toBe(200n);
    expect(amounts[1]).toBe(100n);
  });

  test("zero amounts are swapped correctly", () => {
    const lo = "0x1111111111111111111111111111111111111111" as `0x${string}`;
    const hi = "0x9999999999999999999999999999999999999999" as `0x${string}`;
    const { tokens, amounts } = sortTokensWithAmounts(hi, lo, 0n, 500n);
    expect(tokens).toEqual([lo, hi]);
    expect(amounts).toEqual([500n, 0n]);
  });
});

describe("RateLimiter", () => {
  test("sequential calls respect interval", async () => {
    const limiter = new RateLimiter(30);
    const start = Date.now();
    await limiter.wait();
    await limiter.wait();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(20);
  });

  test("zero-interval limiter executes without delay", async () => {
    const limiter = new RateLimiter(0);
    const start = Date.now();
    await limiter.wait();
    await limiter.wait();
    await limiter.wait();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(500);
  });

  test("multiple queued calls execute in FIFO order", async () => {
    const limiter = new RateLimiter(20);
    const order: number[] = [];
    const promises = [1, 2, 3, 4].map((n) => limiter.wait().then(() => order.push(n)));
    await Promise.all(promises);
    expect(order).toEqual([1, 2, 3, 4]);
  });
});

describe("withFallback", () => {
  test("returns fn result on success", async () => {
    const result = await withFallback(async () => 42, 0, "test");
    expect(result).toBe(42);
  });

  test("returns fallback on error", async () => {
    const result = await withFallback(
      async () => {
        throw new Error("fail");
      },
      99,
      "test",
    );
    expect(result).toBe(99);
  });

  test("returns fallback for rejected promises", async () => {
    const result = await withFallback(() => Promise.reject(new Error("rejected")), -1, "ctx");
    expect(result).toBe(-1);
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
});

describe("isValidLogLevel", () => {
  test("valid levels", () => {
    expect(isValidLogLevel("debug")).toBe(true);
    expect(isValidLogLevel("info")).toBe(true);
    expect(isValidLogLevel("warn")).toBe(true);
    expect(isValidLogLevel("error")).toBe(true);
  });

  test("invalid levels", () => {
    expect(isValidLogLevel("trace")).toBe(false);
    expect(isValidLogLevel("fatal")).toBe(false);
    expect(isValidLogLevel("")).toBe(false);
  });
});

describe("errMsg", () => {
  test("Error object", () => expect(errMsg(new Error("boom"))).toBe("boom"));
  test("string", () => expect(errMsg("oops")).toBe("oops"));
  test("null", () => expect(errMsg(null)).toBe("null"));
  test("number", () => expect(errMsg(42)).toBe("42"));
});
