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

// ---- Track calls for assertions ----
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
// mock.module is process-global in bun:test, so we must re-export all named
// exports from real modules to avoid breaking other test files that import them.

const mockPositions: Position[] = [];
const mockCandles = [{ ts: Date.now(), o: 1.0, h: 1.001, l: 0.999, c: 1.0, v: 1000 }];

// Store mock: only override what executor uses, pass-through the rest.
// We load the real module first, then spread its exports into the mock factory.
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
  position: {
    id: "1:0xpool1:1000",
    pool: "0x0000000000000000000000000000000000000001" as `0x${string}`,
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

// ---- Test fixtures (must be before setDefaultBalances) ----

const POOL1_ADDR = "0x0000000000000000000000000000000000000001" as `0x${string}`;
const POOL2_ADDR = "0x0000000000000000000000000000000000000002" as `0x${string}`;
const TOKEN0_ADDR = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as `0x${string}`;
const TOKEN1_ADDR = "0xdAC17F958D2ee523a2206206994597C13D831ec7" as `0x${string}`;
const PRIVATE_KEY =
  "0x0000000000000000000000000000000000000000000000000000000000000001" as `0x${string}`;

const defaultBalances = new Map<string, bigint>();

function setDefaultBalances(bal0: bigint, bal1: bigint) {
  defaultBalances.clear();
  for (const [, addr] of Object.entries({ t0: TOKEN0_ADDR, t1: TOKEN1_ADDR })) {
    const key = addr.toLowerCase();
    defaultBalances.set(key, addr.toLowerCase() === TOKEN0_ADDR.toLowerCase() ? bal0 : bal1);
  }
}
setDefaultBalances(1000_000000n, 1000_000000n);

let mockBalanceMap: Map<string, bigint> | null = null;

const _realSwap = await import("../../src/execution/swap");
mock.module("../../src/execution/swap", () => {
  const s = { ..._realSwap };
  s.getBalance = mock(async (chain: number, token: `0x${string}`, account: `0x${string}`) => {
    calls.getBalanceCalls.push({ chain, token, account });
    if (mockBalanceMap) return mockBalanceMap.get(`${chain}:${token.toLowerCase()}`) ?? 0n;
    return defaultBalances.get(token.toLowerCase()) ?? 0n;
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

// ---- Import module under test (after mocks) ----
const { executePRA, executeRS } = await import("../../src/executor");

// ---- Helper factories ----

function makePair(overrides?: Partial<PairConfig>): PairConfig {
  return {
    id: "USDC-USDT",
    token0: {
      symbol: "USDC",
      decimals: 6,
      addresses: { 1: TOKEN0_ADDR } as Record<number, `0x${string}`>,
    },
    token1: {
      symbol: "USDT",
      decimals: 6,
      addresses: { 1: TOKEN1_ADDR } as Record<number, `0x${string}`>,
    },
    eoaEnvVar: "PK_USDC_USDT",
    pools: [{ address: POOL1_ADDR, chain: 1, dex: "uniswap_v3" }],
    intervalSec: 900,
    maxPositions: 3,
    thresholds: { pra: 0.05, rs: 0.25 },
    ...overrides,
  };
}

function makeAllocation(pool = POOL1_ADDR, pct = 1, chain = 1): AllocationEntry {
  return { pool, chain, dex: "uniswap_v3", pct, expectedApr: 0.15 };
}

function makePosition(pool = POOL1_ADDR, chain = 1, valueUsd = 1000, apr = 0.1): Position {
  return {
    id: `${chain}:${pool}:${Date.now()}`,
    pool,
    chain,
    dex: "uniswap_v3",
    positionId: "12345",
    tickLower: -100,
    tickUpper: 100,
    liquidity: 1000000n,
    amount0: 500_000000n,
    amount1: 500_000000n,
    entryPrice: 1.0,
    entryTs: Date.now(),
    entryApr: apr,
    entryValueUsd: valueUsd,
  };
}

const fakeDb = {} as Database;

function resetMocks() {
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
    position: makePosition(),
    txHash: "0xmint" as `0x${string}`,
    gasUsed: 200000n,
    gasPrice: 1000000000n,
  };
  setDefaultBalances(1000_000000n, 1000_000000n);
  mockBalanceMap = null;
}

// ---- withRetry (tested indirectly through executePRA/RS mint flow) ----

describe("withRetry (via executePRA)", () => {
  beforeEach(resetMocks);

  test("mint succeeds on first try", async () => {
    const pair = makePair();
    const allocs = [makeAllocation()];
    await executePRA(fakeDb, pair, allocs, "PRA", PRIVATE_KEY);
    const mintLogs = calls.logTx.filter((e) => e.opType === "mint");
    expect(mintLogs).toHaveLength(1);
    expect(mintLogs[0].status).toBe("success");
  });
});

// ---- executePRA ----

describe("executePRA", () => {
  beforeEach(resetMocks);

  test("burns existing positions before minting", async () => {
    const pos = makePosition();
    mockPositions.push(pos);
    const pair = makePair();
    const allocs = [makeAllocation()];

    await executePRA(fakeDb, pair, allocs, "PRA", PRIVATE_KEY);

    const burnLogs = calls.logTx.filter((e) => e.opType === "burn");
    expect(burnLogs).toHaveLength(1);
    expect(burnLogs[0].status).toBe("success");

    expect(calls.deletedPositions).toHaveLength(1);
    expect(calls.deletedPositions[0]).toBe(pos.id);

    const mintLogs = calls.logTx.filter((e) => e.opType === "mint");
    expect(mintLogs).toHaveLength(1);
  });

  test("aborts if burn fails", async () => {
    const pos = makePosition();
    mockPositions.push(pos);
    burnResult = {
      success: false,
      amount0: 0n,
      amount1: 0n,
      hash: "0xfailed" as `0x${string}`,
      gasUsed: 100000n,
      gasPrice: 1000000000n,
    };

    const pair = makePair();
    const allocs = [makeAllocation()];
    await executePRA(fakeDb, pair, allocs, "PRA", PRIVATE_KEY);

    const burnLogs = calls.logTx.filter((e) => e.opType === "burn");
    expect(burnLogs).toHaveLength(1);
    expect(burnLogs[0].status).toBe("reverted");

    expect(calls.deletedPositions).toHaveLength(0);

    const mintLogs = calls.logTx.filter((e) => e.opType === "mint");
    expect(mintLogs).toHaveLength(0);
  });

  test("no existing positions: skips burn, proceeds to mint", async () => {
    const pair = makePair();
    const allocs = [makeAllocation()];
    await executePRA(fakeDb, pair, allocs, "PRA", PRIVATE_KEY);

    expect(calls.burnCalls).toHaveLength(0);
    const mintLogs = calls.logTx.filter((e) => e.opType === "mint");
    expect(mintLogs).toHaveLength(1);
  });

  test("skips mint when balances are zero", async () => {
    setDefaultBalances(0n, 0n);
    const pair = makePair();
    const allocs = [makeAllocation()];
    await executePRA(fakeDb, pair, allocs, "PRA", PRIVATE_KEY);

    const mintLogs = calls.logTx.filter((e) => e.opType === "mint");
    expect(mintLogs).toHaveLength(0);
  });

  test("uses computeRange with forces when provided", async () => {
    const forces: Forces = {
      v: { force: 5, mean: 1.0, std: 0.01 },
      m: { force: 50, up: 5, down: 5 },
      t: { force: 50, ma0: 1.0, ma1: 1.0 },
    };
    const pair = makePair();
    const allocs = [makeAllocation()];
    await executePRA(fakeDb, pair, allocs, "PRA", PRIVATE_KEY, forces);

    const mintLogs = calls.logTx.filter((e) => e.opType === "mint");
    expect(mintLogs).toHaveLength(1);
  });

  test("logs target allocation pct on mint", async () => {
    const pair = makePair();
    const allocs = [makeAllocation(POOL1_ADDR, 0.75)];
    await executePRA(fakeDb, pair, allocs, "PRA", PRIVATE_KEY);

    const mintLogs = calls.logTx.filter((e) => e.opType === "mint");
    expect(mintLogs).toHaveLength(1);
    expect(mintLogs[0].targetAllocationPct).toBe(0.75);
  });

  test("passes correct decision type through to tx log", async () => {
    const pair = makePair();
    const allocs = [makeAllocation()];
    await executePRA(fakeDb, pair, allocs, "RS", PRIVATE_KEY);

    for (const entry of calls.logTx) {
      expect(entry.decisionType).toBe("RS");
    }
  });

  test("handles multiple allocations", async () => {
    const pair = makePair({
      pools: [
        { address: POOL1_ADDR, chain: 1, dex: "uniswap_v3" },
        { address: POOL2_ADDR, chain: 1, dex: "uniswap_v3" },
      ],
    });
    const allocs = [makeAllocation(POOL1_ADDR, 0.6), makeAllocation(POOL2_ADDR, 0.4)];
    await executePRA(fakeDb, pair, allocs, "PRA", PRIVATE_KEY);

    const mintLogs = calls.logTx.filter((e) => e.opType === "mint");
    expect(mintLogs).toHaveLength(2);
  });

  test("allocation amount uses pct of balance", async () => {
    setDefaultBalances(10000_000000n, 10000_000000n);
    const pair = makePair();
    const allocs = [makeAllocation(POOL1_ADDR, 0.5)];
    await executePRA(fakeDb, pair, allocs, "PRA", PRIVATE_KEY);

    expect(calls.mintCalls).toHaveLength(1);
    const mintArgs = calls.mintCalls[0] as unknown[];
    // args: [db, pair, alloc, range, amount0, amount1, privateKey]
    const amt0 = mintArgs[4] as bigint;
    const amt1 = mintArgs[5] as bigint;
    expect(amt0).toBe(5000_000000n); // 50% of 10000
    expect(amt1).toBe(5000_000000n);
  });
});

// ---- logTransaction (tested indirectly via executePRA) ----

describe("logTransaction (via executePRA)", () => {
  beforeEach(resetMocks);

  test("constructs tx log entry with correct fields", async () => {
    const pos = makePosition();
    mockPositions.push(pos);
    const pair = makePair();
    const allocs = [makeAllocation()];
    await executePRA(fakeDb, pair, allocs, "PRA", PRIVATE_KEY);

    const burnLog = calls.logTx.find((e) => e.opType === "burn")!;
    expect(burnLog).toBeDefined();
    expect(burnLog.decisionType).toBe("PRA");
    expect(burnLog.pool).toBe(pos.pool);
    expect(burnLog.chain).toBe(pos.chain);
    expect(burnLog.txHash).toBe("0xburn");
    expect(burnLog.gasUsed).toBe(150000n);
    expect(burnLog.gasPrice).toBe(1000000000n);
    expect(typeof burnLog.ts).toBe("number");

    const mintLog = calls.logTx.find((e) => e.opType === "mint")!;
    expect(mintLog).toBeDefined();
    expect(mintLog.txHash).toBe("0xmint");
    expect(mintLog.gasUsed).toBe(200000n);
    expect(mintLog.status).toBe("success");
  });

  test("defaults optional fields to zero/empty", async () => {
    const pair = makePair();
    const allocs = [makeAllocation()];
    await executePRA(fakeDb, pair, allocs, "PRA", PRIVATE_KEY);

    const mintLog = calls.logTx.find((e) => e.opType === "mint")!;
    expect(mintLog.inputToken).toBe("");
    expect(mintLog.inputAmount).toBe("0");
    expect(mintLog.inputUsd).toBe(0);
    expect(mintLog.outputToken).toBe("");
    expect(mintLog.outputAmount).toBe("0");
    expect(mintLog.outputUsd).toBe(0);
    expect(mintLog.actualAllocationPct).toBe(0);
  });

  test("allocationErrorPct = abs(target - actual)", async () => {
    const pair = makePair();
    const allocs = [makeAllocation(POOL1_ADDR, 0.8)];
    await executePRA(fakeDb, pair, allocs, "PRA", PRIVATE_KEY);

    const mintLog = calls.logTx.find((e) => e.opType === "mint")!;
    expect(mintLog.allocationErrorPct).toBe(Math.abs(0.8 - 0));
  });
});

// ---- executeRS ----

describe("executeRS", () => {
  beforeEach(resetMocks);

  const oldRange: Range = {
    min: 0.99,
    max: 1.01,
    base: 1.0,
    breadth: 0.02,
    confidence: 80,
    trendBias: 0,
    type: "neutral",
  };
  const newRange: Range = {
    min: 0.985,
    max: 1.015,
    base: 1.0,
    breadth: 0.03,
    confidence: 80,
    trendBias: 0,
    type: "neutral",
  };

  test("burns and re-mints matched positions", async () => {
    const pos = makePosition();
    mockPositions.push(pos);
    const pair = makePair();
    const shifts = [{ pool: POOL1_ADDR, chain: 1, oldRange, newRange }];

    await executeRS(fakeDb, pair, shifts, "RS", PRIVATE_KEY);

    const burnLogs = calls.logTx.filter((e) => e.opType === "burn");
    expect(burnLogs).toHaveLength(1);
    expect(burnLogs[0].status).toBe("success");

    const mintLogs = calls.logTx.filter((e) => e.opType === "mint");
    expect(mintLogs).toHaveLength(1);
    expect(mintLogs[0].status).toBe("success");

    expect(calls.deletedPositions).toHaveLength(1);
  });

  test("skips unmatched shifts (no corresponding position)", async () => {
    const pos = makePosition(POOL1_ADDR);
    mockPositions.push(pos);
    const pair = makePair();
    const shifts = [{ pool: POOL2_ADDR, chain: 1, oldRange, newRange }];

    await executeRS(fakeDb, pair, shifts, "RS", PRIVATE_KEY);

    expect(calls.burnCalls).toHaveLength(0);
    expect(calls.logTx).toHaveLength(0);
  });

  test("continues with next position if burn fails", async () => {
    const pos1 = makePosition(POOL1_ADDR, 1, 500);
    const pos2 = makePosition(POOL2_ADDR, 1, 500);
    mockPositions.push(pos1, pos2);

    const pair = makePair({
      pools: [
        { address: POOL1_ADDR, chain: 1, dex: "uniswap_v3" },
        { address: POOL2_ADDR, chain: 1, dex: "uniswap_v3" },
      ],
    });

    burnResult = {
      success: false,
      amount0: 0n,
      amount1: 0n,
      hash: "0xfailburn" as `0x${string}`,
      gasUsed: 100000n,
      gasPrice: 1000000000n,
    };

    const shifts = [
      { pool: POOL1_ADDR, chain: 1, oldRange, newRange },
      { pool: POOL2_ADDR, chain: 1, oldRange, newRange },
    ];
    await executeRS(fakeDb, pair, shifts, "RS", PRIVATE_KEY);

    const burnLogs = calls.logTx.filter((e) => e.opType === "burn");
    expect(burnLogs).toHaveLength(2);
    const mintLogs = calls.logTx.filter((e) => e.opType === "mint");
    expect(mintLogs).toHaveLength(0);
    expect(calls.deletedPositions).toHaveLength(0);
  });

  test("M4: proportional allocation based on entryValueUsd", async () => {
    const pos1 = makePosition(POOL1_ADDR, 1, 3000);
    const pos2 = makePosition(POOL2_ADDR, 1, 1000);
    mockPositions.push(pos1, pos2);

    const pair = makePair({
      pools: [
        { address: POOL1_ADDR, chain: 1, dex: "uniswap_v3" },
        { address: POOL2_ADDR, chain: 1, dex: "uniswap_v3" },
      ],
    });
    const shifts = [
      { pool: POOL1_ADDR, chain: 1, oldRange, newRange },
      { pool: POOL2_ADDR, chain: 1, oldRange, newRange },
    ];

    await executeRS(fakeDb, pair, shifts, "RS", PRIVATE_KEY);

    const mintLogs = calls.logTx.filter((e) => e.opType === "mint");
    expect(mintLogs).toHaveLength(2);

    expect(mintLogs[0].targetAllocationPct).toBe(0.75);
    expect(mintLogs[1].targetAllocationPct).toBe(0.25);
  });

  test("passes newRange from shift to mintPosition", async () => {
    const pos = makePosition();
    mockPositions.push(pos);
    const pair = makePair();
    const shifts = [{ pool: POOL1_ADDR, chain: 1, oldRange, newRange }];

    await executeRS(fakeDb, pair, shifts, "RS", PRIVATE_KEY);

    expect(calls.mintCalls).toHaveLength(1);
    const mintCallArgs = calls.mintCalls[0] as unknown[];
    expect(mintCallArgs[3]).toEqual(newRange);
  });

  test("uses pool dex from matched pool config", async () => {
    const pos = makePosition();
    mockPositions.push(pos);
    const pair = makePair();
    const shifts = [{ pool: POOL1_ADDR, chain: 1, oldRange, newRange }];

    await executeRS(fakeDb, pair, shifts, "RS", PRIVATE_KEY);

    const mintCallArgs = calls.mintCalls[0] as unknown[];
    const alloc = mintCallArgs[2] as AllocationEntry;
    expect(alloc.dex).toBe("uniswap_v3");
  });
});

// ---- rebalanceTokenRatio (tested indirectly via executePRA) ----

describe("rebalanceTokenRatio (via executePRA)", () => {
  beforeEach(resetMocks);

  test("no swap when balances are balanced (imbalance <= 5%)", async () => {
    const pair = makePair();
    const allocs = [makeAllocation()];
    await executePRA(fakeDb, pair, allocs, "PRA", PRIVATE_KEY);

    expect(calls.swapCalls).toHaveLength(0);
  });

  test("triggers swap when significantly imbalanced", async () => {
    setDefaultBalances(900_000000n, 100_000000n);
    const pair = makePair();
    const allocs = [makeAllocation()];
    await executePRA(fakeDb, pair, allocs, "PRA", PRIVATE_KEY);

    expect(calls.swapCalls.length).toBeGreaterThanOrEqual(1);
  });
});

// ---- bridgeCrossChain (tested indirectly via executePRA) ----

const BSC_TOKEN0_ADDR = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d" as `0x${string}`;
const BSC_TOKEN1_ADDR = "0x55d398326f99059fF775485246999027B3197955" as `0x${string}`;

describe("bridgeCrossChain (via executePRA)", () => {
  beforeEach(resetMocks);

  test("bridges funds when allocations span multiple chains", async () => {
    // All balance on chain 1, none on chain 56
    mockBalanceMap = new Map([
      [`1:${TOKEN0_ADDR.toLowerCase()}`, 2000_000000n],
      [`1:${TOKEN1_ADDR.toLowerCase()}`, 2000_000000n],
      [`56:${BSC_TOKEN0_ADDR.toLowerCase()}`, 0n],
      [`56:${BSC_TOKEN1_ADDR.toLowerCase()}`, 0n],
    ]);

    const pair = makePair({
      token0: {
        symbol: "USDC",
        decimals: 6,
        addresses: { 1: TOKEN0_ADDR, 56: BSC_TOKEN0_ADDR } as Record<number, `0x${string}`>,
      },
      token1: {
        symbol: "USDT",
        decimals: 6,
        addresses: { 1: TOKEN1_ADDR, 56: BSC_TOKEN1_ADDR } as Record<number, `0x${string}`>,
      },
      pools: [
        { address: POOL1_ADDR, chain: 1, dex: "uniswap_v3" },
        { address: POOL2_ADDR, chain: 56, dex: "uniswap_v3" },
      ],
    });

    const allocs = [makeAllocation(POOL1_ADDR, 0.5, 1), makeAllocation(POOL2_ADDR, 0.5, 56)];

    await executePRA(fakeDb, pair, allocs, "PRA", PRIVATE_KEY);

    // Should have called swapTokens with fromChain !== toChain (cross-chain bridge)
    const bridgeSwaps = calls.swapCalls.filter((args: unknown[]) => {
      const opts = args[0] as { fromChain: number; toChain: number };
      return opts.fromChain !== opts.toChain;
    });
    expect(bridgeSwaps.length).toBeGreaterThanOrEqual(1);

    const opts = bridgeSwaps[0][0] as { fromChain: number; toChain: number };
    expect(opts.fromChain).toBe(1);
    expect(opts.toChain).toBe(56);
  });

  test("skips bridge when all allocations are on the same chain", async () => {
    const pair = makePair();
    const allocs = [makeAllocation(POOL1_ADDR, 1, 1)];
    await executePRA(fakeDb, pair, allocs, "PRA", PRIVATE_KEY);

    const bridgeSwaps = calls.swapCalls.filter((args: unknown[]) => {
      const opts = args[0] as { fromChain: number; toChain: number };
      return opts.fromChain !== opts.toChain;
    });
    expect(bridgeSwaps).toHaveLength(0);
  });
});
