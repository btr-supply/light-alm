import { describe, expect, test } from "bun:test";
import {
  applySlippage,
  extractTokenIdFromLogs,
  extractCollectedAmounts,
} from "../../src/execution/positions";

// ---- applySlippage ----

describe("applySlippage", () => {
  test("default 50bps slippage", () => {
    // 10000 - (10000 * 50) / 10000 = 10000 - 50 = 9950
    expect(applySlippage(10000n)).toBe(9950n);
  });

  test("custom slippage bps", () => {
    // 100bps = 1%: 10000 - (10000 * 100) / 10000 = 9900
    expect(applySlippage(10000n, 100)).toBe(9900n);
  });

  test("zero amount returns zero", () => {
    expect(applySlippage(0n)).toBe(0n);
  });

  test("zero slippage returns original", () => {
    expect(applySlippage(10000n, 0)).toBe(10000n);
  });

  test("large amount precision", () => {
    const amount = 1_000_000_000_000n; // 1e12
    // 50bps = 0.5%: 1e12 * 50 / 10000 = 5_000_000_000 -> 1e12 - 5e9 = 995_000_000_000
    expect(applySlippage(amount)).toBe(995_000_000_000n);
  });

  test("small amount rounds down via bigint division", () => {
    // 99n * 50 / 10000 = 4950 / 10000 = 0 (bigint floor)
    // 99 - 0 = 99
    expect(applySlippage(99n)).toBe(99n);
  });

  test("1 wei at default slippage", () => {
    // 1 * 50 / 10000 = 0 -> 1 - 0 = 1
    expect(applySlippage(1n)).toBe(1n);
  });

  test("amount exactly 10000 at 10000bps returns zero", () => {
    // 10000 * 10000 / 10000 = 10000 -> 10000 - 10000 = 0
    expect(applySlippage(10000n, 10000)).toBe(0n);
  });
});

// ---- extractTokenIdFromLogs ----

const ERC721_TRANSFER_SIG =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as `0x${string}`;

function padAddress(addr: string): `0x${string}` {
  return `0x${addr.replace("0x", "").padStart(64, "0")}` as `0x${string}`;
}

function padUint256(value: bigint): `0x${string}` {
  return `0x${value.toString(16).padStart(64, "0")}` as `0x${string}`;
}

describe("extractTokenIdFromLogs", () => {
  test("extracts tokenId from ERC721 Transfer event", () => {
    const logs = [
      {
        topics: [
          ERC721_TRANSFER_SIG,
          padAddress("0x0000000000000000000000000000000000000000"), // from (zero = mint)
          padAddress("0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"), // to
          padUint256(42069n), // tokenId
        ] as readonly `0x${string}`[],
        data: "0x" as `0x${string}`,
        address: "0x1234567890123456789012345678901234567890" as `0x${string}`,
      },
    ];
    expect(extractTokenIdFromLogs(logs)).toBe("42069");
  });

  test("returns empty string when no Transfer event found", () => {
    const logs = [
      {
        topics: [
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `0x${string}`,
        ] as readonly `0x${string}`[],
        data: "0x" as `0x${string}`,
        address: "0x1234567890123456789012345678901234567890" as `0x${string}`,
      },
    ];
    expect(extractTokenIdFromLogs(logs)).toBe("");
  });

  test("returns empty string for empty logs", () => {
    expect(extractTokenIdFromLogs([])).toBe("");
  });

  test("ignores ERC20 Transfer (3 topics, not 4)", () => {
    // ERC20 Transfer has same sig but only 3 topics (from, to in topics, amount in data)
    const logs = [
      {
        topics: [
          ERC721_TRANSFER_SIG,
          padAddress("0xaaaa"),
          padAddress("0xbbbb"),
        ] as readonly `0x${string}`[],
        data: padUint256(1000n),
        address: "0x1234567890123456789012345678901234567890" as `0x${string}`,
      },
    ];
    expect(extractTokenIdFromLogs(logs)).toBe("");
  });

  test("finds first ERC721 Transfer among multiple logs", () => {
    const logs = [
      {
        // ERC20 Transfer (3 topics)
        topics: [
          ERC721_TRANSFER_SIG,
          padAddress("0xaaaa"),
          padAddress("0xbbbb"),
        ] as readonly `0x${string}`[],
        data: padUint256(1000n),
        address: "0x1111111111111111111111111111111111111111" as `0x${string}`,
      },
      {
        // Random event
        topics: [
          "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as `0x${string}`,
        ] as readonly `0x${string}`[],
        data: "0x" as `0x${string}`,
        address: "0x2222222222222222222222222222222222222222" as `0x${string}`,
      },
      {
        // ERC721 Transfer (4 topics) — this is the target
        topics: [
          ERC721_TRANSFER_SIG,
          padAddress("0x0000000000000000000000000000000000000000"),
          padAddress("0xdeadbeef"),
          padUint256(999n),
        ] as readonly `0x${string}`[],
        data: "0x" as `0x${string}`,
        address: "0x3333333333333333333333333333333333333333" as `0x${string}`,
      },
    ];
    expect(extractTokenIdFromLogs(logs)).toBe("999");
  });

  test("handles tokenId = 0", () => {
    const logs = [
      {
        topics: [
          ERC721_TRANSFER_SIG,
          padAddress("0x0000"),
          padAddress("0xaaaa"),
          padUint256(0n),
        ] as readonly `0x${string}`[],
        data: "0x" as `0x${string}`,
        address: "0x1234567890123456789012345678901234567890" as `0x${string}`,
      },
    ];
    expect(extractTokenIdFromLogs(logs)).toBe("0");
  });

  test("handles large tokenId", () => {
    const largeId = 2n ** 128n;
    const logs = [
      {
        topics: [
          ERC721_TRANSFER_SIG,
          padAddress("0x0000"),
          padAddress("0xaaaa"),
          padUint256(largeId),
        ] as readonly `0x${string}`[],
        data: "0x" as `0x${string}`,
        address: "0x1234567890123456789012345678901234567890" as `0x${string}`,
      },
    ];
    expect(extractTokenIdFromLogs(logs)).toBe(largeId.toString());
  });
});

// ---- extractCollectedAmounts ----

const COLLECT_EVENT_SIG =
  "0x40d0efd1a53d60ecbf40971b9daf7dc90178c3aadc7aab1765632738fa8b8f01" as `0x${string}`;

function encodeCollectData(recipient: string, amount0: bigint, amount1: bigint): `0x${string}` {
  const addr = recipient.replace("0x", "").padStart(64, "0");
  const a0 = amount0.toString(16).padStart(64, "0");
  const a1 = amount1.toString(16).padStart(64, "0");
  return `0x${addr}${a0}${a1}` as `0x${string}`;
}

describe("extractCollectedAmounts", () => {
  test("extracts amounts from matching Collect event", () => {
    const tokenId = 12345n;
    const logs = [
      {
        topics: [COLLECT_EVENT_SIG, padUint256(tokenId)] as readonly `0x${string}`[],
        data: encodeCollectData("0xdeadbeef", 5000n, 3000n),
        address: "0x1234567890123456789012345678901234567890" as `0x${string}`,
      },
    ];
    const result = extractCollectedAmounts(logs, tokenId);
    expect(result).not.toBeNull();
    expect(result!.amount0).toBe(5000n);
    expect(result!.amount1).toBe(3000n);
  });

  test("returns null when tokenId does not match", () => {
    const logs = [
      {
        topics: [
          COLLECT_EVENT_SIG,
          padUint256(999n), // different tokenId
        ] as readonly `0x${string}`[],
        data: encodeCollectData("0xdeadbeef", 5000n, 3000n),
        address: "0x1234567890123456789012345678901234567890" as `0x${string}`,
      },
    ];
    expect(extractCollectedAmounts(logs, 12345n)).toBeNull();
  });

  test("returns null for empty logs", () => {
    expect(extractCollectedAmounts([], 1n)).toBeNull();
  });

  test("returns null when no Collect event present", () => {
    const logs = [
      {
        topics: [
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `0x${string}`,
          padUint256(1n),
        ] as readonly `0x${string}`[],
        data: encodeCollectData("0xdeadbeef", 100n, 200n),
        address: "0x1234567890123456789012345678901234567890" as `0x${string}`,
      },
    ];
    expect(extractCollectedAmounts(logs, 1n)).toBeNull();
  });

  test("handles large amounts", () => {
    const tokenId = 1n;
    const large0 = 10n ** 24n; // 1M USDC at 18 decimals
    const large1 = 10n ** 24n;
    const logs = [
      {
        topics: [COLLECT_EVENT_SIG, padUint256(tokenId)] as readonly `0x${string}`[],
        data: encodeCollectData("0xdeadbeef", large0, large1),
        address: "0x1234567890123456789012345678901234567890" as `0x${string}`,
      },
    ];
    const result = extractCollectedAmounts(logs, tokenId);
    expect(result).not.toBeNull();
    expect(result!.amount0).toBe(large0);
    expect(result!.amount1).toBe(large1);
  });

  test("handles zero amounts", () => {
    const tokenId = 1n;
    const logs = [
      {
        topics: [COLLECT_EVENT_SIG, padUint256(tokenId)] as readonly `0x${string}`[],
        data: encodeCollectData("0xdeadbeef", 0n, 0n),
        address: "0x1234567890123456789012345678901234567890" as `0x${string}`,
      },
    ];
    const result = extractCollectedAmounts(logs, tokenId);
    expect(result).not.toBeNull();
    expect(result!.amount0).toBe(0n);
    expect(result!.amount1).toBe(0n);
  });

  test("picks correct Collect event among multiple logs", () => {
    const targetId = 5n;
    const logs = [
      {
        // Collect for a different tokenId
        topics: [COLLECT_EVENT_SIG, padUint256(99n)] as readonly `0x${string}`[],
        data: encodeCollectData("0xdeadbeef", 111n, 222n),
        address: "0x1234567890123456789012345678901234567890" as `0x${string}`,
      },
      {
        // Random event
        topics: [
          ERC721_TRANSFER_SIG,
          padAddress("0x0000"),
          padAddress("0xaaaa"),
          padUint256(5n),
        ] as readonly `0x${string}`[],
        data: "0x" as `0x${string}`,
        address: "0x2222222222222222222222222222222222222222" as `0x${string}`,
      },
      {
        // Collect for the target tokenId
        topics: [COLLECT_EVENT_SIG, padUint256(targetId)] as readonly `0x${string}`[],
        data: encodeCollectData("0xdeadbeef", 777n, 888n),
        address: "0x3333333333333333333333333333333333333333" as `0x${string}`,
      },
    ];
    const result = extractCollectedAmounts(logs, targetId);
    expect(result).not.toBeNull();
    expect(result!.amount0).toBe(777n);
    expect(result!.amount1).toBe(888n);
  });
});
