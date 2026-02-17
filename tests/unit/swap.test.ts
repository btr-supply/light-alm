import { describe, expect, test, mock, beforeAll, beforeEach, afterEach } from "bun:test";
import { verifyCalldata, waitForArrival, lifiQuote, limiters } from "../../src/execution/swap";
import { RateLimiter } from "../../src/utils";
import { silenceLog } from "../helpers";

// Bypass rate limiting + silence expected warnings in unit tests
beforeAll(() => {
  limiters.jumper = new RateLimiter(0);
  limiters.lifi = new RateLimiter(0);
  silenceLog();
});

// -- verifyCalldata --

describe("verifyCalldata", () => {
  test("returns false when simulateContract throws", async () => {
    const result = await verifyCalldata(
      999,
      "0xdeadbeef",
      "0x0000000000000000000000000000000000000001",
    );
    expect(result).toBe(false);
  });

  test("returns false for empty calldata", async () => {
    const result = await verifyCalldata(1, "0x", "0x0000000000000000000000000000000000000001");
    expect(result).toBe(false);
  });
});

// -- waitForArrival --

describe("waitForArrival", () => {
  test("returns new balance when it exceeds balanceBefore", async () => {
    let callCount = 0;
    const mockGetBalance = mock(() => {
      callCount++;
      return Promise.resolve(callCount < 3 ? 1000n : 2000n);
    });

    const result = await waitForArrival(
      1,
      "0x0000000000000000000000000000000000000001",
      "0x0000000000000000000000000000000000000002",
      1000n,
      5000,
      10,
      mockGetBalance,
    );
    expect(result).toBe(2000n);
    expect(callCount).toBeGreaterThanOrEqual(3);
  });

  test("throws on timeout", async () => {
    const mockGetBalance = mock(() => Promise.resolve(100n));

    await expect(
      waitForArrival(
        1,
        "0x0000000000000000000000000000000000000001",
        "0x0000000000000000000000000000000000000002",
        100n,
        50,
        10,
        mockGetBalance,
      ),
    ).rejects.toThrow("waitForArrival timeout");
  });
});

// -- lifiQuote (lifi backend) --

const QUOTE_PARAMS = {
  fromChain: 1,
  toChain: 1,
  fromToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  toToken: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  fromAmount: "1000000",
  fromAddress: "0x0000000000000000000000000000000000000001",
  toAddress: "0x0000000000000000000000000000000000000001",
} as const;

const MOCK_LIFI_QUOTE = {
  type: "swap",
  transactionRequest: {
    to: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
    data: "0xabcd",
    value: "0",
    gasLimit: "300000",
  },
  estimate: {
    fromAmount: "1000000",
    toAmount: "999000",
    toAmountMin: "994000",
    approvalAddress: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
  },
  action: { fromChainId: 1, toChainId: 1, toAddress: "0x0000000000000000000000000000000000000001" },
};

describe("lifiQuote (lifi backend)", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("parses a valid Li.Fi quote response", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify(MOCK_LIFI_QUOTE), { status: 200 })),
    ) as typeof fetch;

    const result = await lifiQuote(QUOTE_PARAMS, "lifi");
    expect(result).not.toBeNull();
    expect(result!.type).toBe("swap");
    expect(result!.estimate.toAmount).toBe("999000");
    expect(result!.estimate.toAmountMin).toBe("994000");
    expect(result!.transactionRequest.to).toBe("0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE");
    expect(result!.action.fromChainId).toBe(1);
  });

  test("returns null on HTTP error", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("Bad Request", { status: 400 })),
    ) as typeof fetch;

    const result = await lifiQuote(QUOTE_PARAMS, "lifi");
    expect(result).toBeNull();
  });

  test("returns null on fetch failure", async () => {
    globalThis.fetch = mock(() => Promise.reject(new Error("Network error"))) as typeof fetch;

    const result = await lifiQuote(QUOTE_PARAMS, "lifi");
    expect(result).toBeNull();
  }, 30_000);
});

// -- lifiQuote (jumper backend) --

const MOCK_JUMPER_ROUTES = {
  routes: [
    {
      toAmount: "999500",
      toAmountMin: "994500",
      steps: [
        {
          type: "swap",
          action: {
            fromChainId: 1,
            toChainId: 1,
            toAddress: "0x0000000000000000000000000000000000000001",
          },
          estimate: {
            fromAmount: "1000000",
            toAmount: "999500",
            toAmountMin: "994500",
            approvalAddress: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
            feeCosts: [],
          },
        },
      ],
    },
  ],
};

const MOCK_JUMPER_TX_STEP = {
  type: "swap",
  transactionRequest: {
    to: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
    data: "0xabcd",
    value: "0",
    gasLimit: "300000",
  },
  estimate: { approvalAddress: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE" },
};

describe("lifiQuote (jumper backend)", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("parses a valid Jumper two-step response", async () => {
    let callIdx = 0;
    globalThis.fetch = mock((url: string) => {
      callIdx++;
      if (callIdx === 1) {
        expect(url).toContain("/routes");
        return Promise.resolve(new Response(JSON.stringify(MOCK_JUMPER_ROUTES), { status: 200 }));
      }
      expect(url).toContain("/stepTransaction");
      return Promise.resolve(new Response(JSON.stringify(MOCK_JUMPER_TX_STEP), { status: 200 }));
    }) as typeof fetch;

    const result = await lifiQuote(QUOTE_PARAMS, "jumper");
    expect(result).not.toBeNull();
    expect(result!.type).toBe("swap");
    expect(result!.estimate.toAmount).toBe("999500");
    expect(result!.estimate.toAmountMin).toBe("994500");
    expect(result!.transactionRequest.to).toBe("0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE");
    expect(result!.transactionRequest.data).toBe("0xabcd");
    expect(result!.action.fromChainId).toBe(1);
  });

  test("returns null when feeCosts present", async () => {
    const routesWithFees = {
      routes: [
        {
          toAmount: "999000",
          toAmountMin: "994000",
          steps: [
            {
              type: "swap",
              action: { fromChainId: 1, toChainId: 1, toAddress: "0x01" },
              estimate: {
                fromAmount: "1000000",
                approvalAddress: "0x01",
                feeCosts: [{ amount: "2500", token: "0x01" }],
              },
            },
          ],
        },
      ],
    };
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify(routesWithFees), { status: 200 })),
    ) as typeof fetch;

    const result = await lifiQuote(QUOTE_PARAMS, "jumper");
    expect(result).toBeNull();
  });

  test("returns null when no routes", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ routes: [] }), { status: 200 })),
    ) as typeof fetch;

    const result = await lifiQuote(QUOTE_PARAMS, "jumper");
    expect(result).toBeNull();
  });

  test("returns null on routes fetch failure", async () => {
    globalThis.fetch = mock(() => Promise.reject(new Error("Network error"))) as typeof fetch;

    const result = await lifiQuote(QUOTE_PARAMS, "jumper");
    expect(result).toBeNull();
  });
});
