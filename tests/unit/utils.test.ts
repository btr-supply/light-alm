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
