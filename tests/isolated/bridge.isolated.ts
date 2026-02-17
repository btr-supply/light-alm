import { describe, expect, test, mock, beforeEach } from "bun:test";
import type { Database } from "bun:sqlite";
import type {
  PairConfig,
  AllocationEntry,
  Position,
  Range,
  Forces,
  TxLogEntry,
} from "../../src/types";

// ---- Track calls ----
const calls = {
  logTx: [] as TxLogEntry[],
  deletedPositions: [] as string[],
  burnCalls: [] as Position[],
  mintCalls: [] as unknown[],
  swapCalls: [] as unknown[],
  getBalanceCalls: [] as unknown[],
};

function resetCalls() {
  calls.logTx = [];
  calls.deletedPositions = [];
  calls.burnCalls = [];
  calls.mintCalls = [];
  calls.swapCalls = [];
  calls.getBalanceCalls = [];
}

// ---- Mock modules ----
const mockPositions: Position[] = [];
const mockCandles = [{ ts: Date.now(), o: 1.0, h: 1.001, l: 0.999, c: 1.0, v: 1000 }];

const _realStore = await import("../../src/data/store");
mock.module("../../src/data/store", () => {
  const s = { ..._realStore };
  s.getPositions = mock((_db: Database) => mockPositions) as typeof s.getPositions;
  s.getCandles = mock(
    (_db: Database, _from: number, _to: number) => mockCandles,
  ) as typeof s.getCandles;
  s.logTx = mock((_db: Database, entry: TxLogEntry) => {
    calls.logTx.push(entry);
  }) as typeof s.logTx;
  s.deletePosition = mock((_db: Database, id: string) => {
    calls.deletedPositions.push(id);
  }) as typeof s.deletePosition;
  return s;
});

let burnResult: {
  success: boolean;
  amount0: bigint;
  amount1: bigint;
  hash: `0x${string}`;
  gasUsed: bigint;
  gasPrice: bigint;
} | null = {
  success: true,
  amount0: 500_000000n,
  amount1: 500_000000n,
  hash: "0xabc123" as `0x${string}`,
  gasUsed: 150000n,
  gasPrice: 1000000000n,
};

let mintResult: {
  position: Position | null;
  txHash: `0x${string}`;
  gasUsed: bigint;
  gasPrice: bigint;
} = {
  position: null,
  txHash: "0xdef456" as `0x${string}`,
  gasUsed: 200000n,
  gasPrice: 1000000000n,
};

const _realPositions = await import("../../src/execution/positions");
mock.module("../../src/execution/positions", () => {
  const p = { ..._realPositions };
  p.burnPosition = mock(async (pos: Position) => {
    calls.burnCalls.push(pos);
    return burnResult;
  }) as typeof p.burnPosition;
  p.mintPosition = mock(async (...args: unknown[]) => {
    calls.mintCalls.push(args);
    return mintResult;
  }) as typeof p.mintPosition;
  return p;
});

let mockBalanceMap: Map<string, bigint> | null = null;

const _realSwap = await import("../../src/execution/swap");
mock.module("../../src/execution/swap", () => {
  const s = { ..._realSwap };
  s.getBalance = mock(async (chain: number, token: `0x${string}`, _account: `0x${string}`) => {
    calls.getBalanceCalls.push({ chain, token });
    if (mockBalanceMap) return mockBalanceMap.get(`${chain}:${token.toLowerCase()}`) ?? 0n;
    return 1000_000000n;
  }) as typeof s.getBalance;
  s.swapTokens = mock(async (...args: unknown[]) => {
    calls.swapCalls.push(args);
    return { amountOut: 100_000000n, sourceTxHash: "0xswap" as `0x${string}` };
  }) as typeof s.swapTokens;
  s.waitForArrival = mock(async () => 1100_000000n) as typeof s.waitForArrival;
  return s;
});

const _realRange = await import("../../src/strategy/range");
mock.module("../../src/strategy/range", () => {
  const r = { ..._realRange };
  r.computeRange = mock(
    (price: number, _forces: Forces): Range => ({
      min: price * 0.99,
      max: price * 1.01,
      base: price,
      breadth: 0.02,
      confidence: 80,
      trendBias: 0,
      type: "neutral" as const,
    }),
  ) as typeof r.computeRange;
  return r;
});

const _realTx = await import("../../src/execution/tx");
mock.module("../../src/execution/tx", () => {
  const t = { ..._realTx };
  t.getAccount = mock((_pk: `0x${string}`) => ({
    address: "0xACCOUNT0000000000000000000000000000000001" as `0x${string}`,
  })) as typeof t.getAccount;
  return t;
});

const { executePRA } = await import("../../src/executor");

// ---- Fixtures ----
const POOL1 = "0x0000000000000000000000000000000000000001" as `0x${string}`;
const POOL2 = "0x0000000000000000000000000000000000000002" as `0x${string}`;
const ETH_USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as `0x${string}`;
const ETH_USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7" as `0x${string}`;
const BSC_USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d" as `0x${string}`;
const BSC_USDT = "0x55d398326f99059fF775485246999027B3197955" as `0x${string}`;
const PK = "0x0000000000000000000000000000000000000000000000000000000000000001" as `0x${string}`;
const fakeDb = {} as Database;

function makeMultiChainPair(): PairConfig {
  return {
    id: "USDC-USDT",
    token0: {
      symbol: "USDC",
      decimals: 6,
      addresses: { 1: ETH_USDC, 56: BSC_USDC } as Record<number, `0x${string}`>,
    },
    token1: {
      symbol: "USDT",
      decimals: 6,
      addresses: { 1: ETH_USDT, 56: BSC_USDT } as Record<number, `0x${string}`>,
    },
    eoaEnvVar: "PK_USDC_USDT",
    pools: [
      { address: POOL1, chain: 1, dex: "uniswap_v3" },
      { address: POOL2, chain: 56, dex: "uniswap_v3" },
    ],
    intervalSec: 900,
    maxPositions: 3,
    thresholds: { pra: 0.05, rs: 0.25 },
  };
}

// ---- bridgeCrossChain tests (via executePRA) ----

describe("bridgeCrossChain — cross-chain balance deltas", () => {
  beforeEach(() => {
    resetCalls();
    mockPositions.length = 0;
    burnResult = {
      success: true,
      amount0: 500_000000n,
      amount1: 500_000000n,
      hash: "0xburn" as `0x${string}`,
      gasUsed: 150000n,
      gasPrice: 1000000000n,
    };
    mintResult = {
      position: {
        id: "1:0xpool1:1000",
        pool: POOL1,
        chain: 1,
        dex: "uniswap_v3",
        positionId: "12345",
        tickLower: -100,
        tickUpper: 100,
        liquidity: 1000000n,
        amount0: 500_000000n,
        amount1: 500_000000n,
        entryPrice: 1.0,
        entryTs: Date.now(),
        entryApr: 0.15,
        entryValueUsd: 1000,
      },
      txHash: "0xmint" as `0x${string}`,
      gasUsed: 200000n,
      gasPrice: 1000000000n,
    };
    mockBalanceMap = null;
  });

  test("bridges from surplus chain to deficit chain", async () => {
    // All balance on chain 1, none on chain 56 -> must bridge
    mockBalanceMap = new Map([
      [`1:${ETH_USDC.toLowerCase()}`, 2000_000000n],
      [`1:${ETH_USDT.toLowerCase()}`, 2000_000000n],
      [`56:${BSC_USDC.toLowerCase()}`, 0n],
      [`56:${BSC_USDT.toLowerCase()}`, 0n],
    ]);

    const pair = makeMultiChainPair();
    const allocs: AllocationEntry[] = [
      { pool: POOL1, chain: 1, dex: "uniswap_v3", pct: 0.5, expectedApr: 0.15 },
      { pool: POOL2, chain: 56, dex: "uniswap_v3", pct: 0.5, expectedApr: 0.15 },
    ];

    await executePRA(fakeDb, pair, allocs, "PRA", PK);

    const bridgeSwaps = calls.swapCalls.filter((args: unknown[]) => {
      const opts = args[0] as { fromChain: number; toChain: number };
      return opts.fromChain !== opts.toChain;
    });
    expect(bridgeSwaps.length).toBeGreaterThanOrEqual(1);

    const opts = bridgeSwaps[0][0] as {
      fromChain: number;
      toChain: number;
      fromToken: string;
      toToken: string;
    };
    expect(opts.fromChain).toBe(1);
    expect(opts.toChain).toBe(56);
    expect(opts.fromToken.toLowerCase()).toBe(ETH_USDC.toLowerCase());
    expect(opts.toToken.toLowerCase()).toBe(BSC_USDC.toLowerCase());
  });

  test("no bridge when allocations are single-chain", async () => {
    const pair: PairConfig = {
      id: "USDC-USDT",
      token0: {
        symbol: "USDC",
        decimals: 6,
        addresses: { 1: ETH_USDC } as Record<number, `0x${string}`>,
      },
      token1: {
        symbol: "USDT",
        decimals: 6,
        addresses: { 1: ETH_USDT } as Record<number, `0x${string}`>,
      },
      eoaEnvVar: "PK_USDC_USDT",
      pools: [{ address: POOL1, chain: 1, dex: "uniswap_v3" }],
      intervalSec: 900,
      maxPositions: 3,
      thresholds: { pra: 0.05, rs: 0.25 },
    };

    await executePRA(
      fakeDb,
      pair,
      [{ pool: POOL1, chain: 1, dex: "uniswap_v3", pct: 1, expectedApr: 0.15 }],
      "PRA",
      PK,
    );

    const bridgeSwaps = calls.swapCalls.filter((args: unknown[]) => {
      const opts = args[0] as { fromChain: number; toChain: number };
      return opts.fromChain !== opts.toChain;
    });
    expect(bridgeSwaps).toHaveLength(0);
  });

  test("no bridge when both chains already have proportional balances", async () => {
    // 50/50 split target, and balances are already 50/50
    mockBalanceMap = new Map([
      [`1:${ETH_USDC.toLowerCase()}`, 1000_000000n],
      [`1:${ETH_USDT.toLowerCase()}`, 1000_000000n],
      [`56:${BSC_USDC.toLowerCase()}`, 1000_000000n],
      [`56:${BSC_USDT.toLowerCase()}`, 1000_000000n],
    ]);

    const pair = makeMultiChainPair();
    const allocs: AllocationEntry[] = [
      { pool: POOL1, chain: 1, dex: "uniswap_v3", pct: 0.5, expectedApr: 0.15 },
      { pool: POOL2, chain: 56, dex: "uniswap_v3", pct: 0.5, expectedApr: 0.15 },
    ];

    await executePRA(fakeDb, pair, allocs, "PRA", PK);

    const bridgeSwaps = calls.swapCalls.filter((args: unknown[]) => {
      const opts = args[0] as { fromChain: number; toChain: number };
      return opts.fromChain !== opts.toChain;
    });
    expect(bridgeSwaps).toHaveLength(0);
  });

  test("bridge amount reflects surplus magnitude", async () => {
    // Chain 1 has 80% of total, target is 50% -> surplus of ~30%
    mockBalanceMap = new Map([
      [`1:${ETH_USDC.toLowerCase()}`, 4000_000000n],
      [`1:${ETH_USDT.toLowerCase()}`, 4000_000000n],
      [`56:${BSC_USDC.toLowerCase()}`, 1000_000000n],
      [`56:${BSC_USDT.toLowerCase()}`, 1000_000000n],
    ]);

    const pair = makeMultiChainPair();
    const allocs: AllocationEntry[] = [
      { pool: POOL1, chain: 1, dex: "uniswap_v3", pct: 0.5, expectedApr: 0.15 },
      { pool: POOL2, chain: 56, dex: "uniswap_v3", pct: 0.5, expectedApr: 0.15 },
    ];

    await executePRA(fakeDb, pair, allocs, "PRA", PK);

    const bridgeSwaps = calls.swapCalls.filter((args: unknown[]) => {
      const opts = args[0] as { fromChain: number; toChain: number };
      return opts.fromChain !== opts.toChain;
    });
    expect(bridgeSwaps.length).toBeGreaterThanOrEqual(1);

    const opts = bridgeSwaps[0][0] as { amount: bigint };
    // Surplus is ~30% of 10000 total USD = ~3000 USD -> ~3000_000000 in 6-dec
    expect(opts.amount).toBeGreaterThan(2000_000000n);
    expect(opts.amount).toBeLessThan(4000_000000n);
  });
});
