import { describe, expect, test, mock, beforeEach, beforeAll } from "bun:test";
import type { PairConfig, PoolConfig, PoolSnapshot, Position } from "../../src/types";
import { silenceLog } from "../helpers";

beforeAll(silenceLog);

const poolAddr = "0x0000000000000000000000000000000000000001" as `0x${string}`;

let mockSnapshots: PoolSnapshot[] = [];
const executePRAMock = mock(async () => {});
const executeRSMock = mock(async () => {});

// ---- In-memory mock DragonflyStore ----

const positionsMap = new Map<string, Position>();
let optimizerState: { vec: number[]; fitness: number } | null = null;
let epoch = 0;
let regimeSuppress = 0;
let candleCursor = 0;

const mockStore = {
  savePosition: async (p: Position) => { positionsMap.set(p.id, p); },
  getPositions: async () => [...positionsMap.values()],
  deletePosition: async (id: string) => { positionsMap.delete(id); },
  getOptimizerState: async () => optimizerState,
  saveOptimizerState: async (vec: number[], fitness: number) => {
    optimizerState = { vec, fitness };
  },
  getEpoch: async () => epoch,
  incrementEpoch: async () => ++epoch,
  getRegimeSuppressUntil: async () => regimeSuppress,
  setRegimeSuppressUntil: async (e: number) => { regimeSuppress = e; },
  getLatestCandleTs: async () => candleCursor,
  setLatestCandleTs: async (ts: number) => { candleCursor = ts; },
  deleteAll: async () => {
    positionsMap.clear();
    optimizerState = null;
    epoch = 0;
    regimeSuppress = 0;
    candleCursor = 0;
  },
};

function resetMockStore() {
  positionsMap.clear();
  optimizerState = null;
  epoch = 0;
  regimeSuppress = 0;
  candleCursor = 0;
}

// ---- Track ingested pair allocations ----
let lastIngestedAllocation: any = null;

mock.module("../../src/data/ohlc", () => ({
  fetchLatestM1: mock(async () => []),
  backfill: mock(async () => {}),
}));

mock.module("../../src/data/gecko", () => ({
  fetchPoolSnapshots: mock(async () => mockSnapshots),
  fetchPool: mock(async () => ({})),
  intervalVolume: (current: any, previous: any, intervalSec: number) => {
    if (!previous) return current.volume24h / (86400 / intervalSec);
    const diff = current.volume24h - previous.volume24h;
    if (diff < 0) return current.volume24h / (86400 / intervalSec);
    return diff;
  },
}));

mock.module("../../src/executor", () => ({
  executePRA: executePRAMock,
  executeRS: executeRSMock,
}));

mock.module("../../src/data/store-o2", () => ({
  getLastSnapshot: mock(async () => null),
  getLatestPairAllocation: mock(async () => lastIngestedAllocation),
  getPairAllocations: mock(async () => lastIngestedAllocation ? [lastIngestedAllocation] : []),
  getRecentYields: mock(async () => []),
  getRecentRsTimestamps: mock(async () => []),
  getTrailingTxCount: mock(async () => 0),
  getCandles: mock(async () => []),
  getPoolAnalyses: mock(async () => []),
  getLatestAnalysesForPools: mock(async () => []),
  getTxLogs: mock(async () => []),
  getEpochSnapshots: mock(async () => []),
}));

mock.module("../../src/infra/o2", () => ({
  ingestToO2: mock((stream: string, rows: any[]) => {
    if (stream === "pair_allocations" && rows.length > 0) {
      lastIngestedAllocation = rows[0];
    }
  }),
}));

const { runSingleCycle } = await import("../../src/scheduler");
const { registerPair, getPair } = await import("../../src/state");

describe("cycle", () => {
  const poolCfg: PoolConfig = {
    address: poolAddr,
    chain: 1,
    dex: "uniswap_v3",
  };

  const pair: PairConfig = {
    id: "USDC-USDT",
    token0: {
      symbol: "USDC",
      decimals: 6,
      addresses: { 1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as `0x${string}` },
    },
    token1: {
      symbol: "USDT",
      decimals: 6,
      addresses: { 1: "0xdAC17F958D2ee523a2206206994597C13D831ec7" as `0x${string}` },
    },
    eoaEnvVar: "PK_USDC_USDT",
    pools: [poolCfg],
    intervalSec: 900,
    maxPositions: 3,
    thresholds: { pra: 0.05, rs: 0.25 },
  };

  beforeEach(() => {
    resetMockStore();
    registerPair(pair.id, mockStore as any, pair);
    mockSnapshots = [];
    lastIngestedAllocation = null;
    executePRAMock.mockClear();
    executeRSMock.mockClear();
  });

  const snapshot: PoolSnapshot = {
    pool: poolAddr,
    chain: 1,
    ts: Date.now(),
    volume24h: 500_000,
    tvl: 5_000_000,
    feePct: 0.0005,
    basePriceUsd: 1.0,
    quotePriceUsd: 1.0,
    exchangeRate: 1.0,
    priceChangeH1: 0,
    priceChangeH24: 0,
  };

  test("returns HOLD when no snapshots available", async () => {
    mockSnapshots = [];
    const decision = await runSingleCycle(mockStore as any, pair, null);
    expect(decision.type).toBe("HOLD");
    expect(decision.currentApr).toBe(0);
    expect(decision.optimalApr).toBe(0);
    expect(decision.targetAllocations).toHaveLength(0);
  });

  test("returns a valid decision when snapshots are available", async () => {
    mockSnapshots = [snapshot];
    const decision = await runSingleCycle(mockStore as any, pair, null);
    expect(["HOLD", "PRA", "RS"]).toContain(decision.type);
    expect(decision.ts).toBeGreaterThan(0);
    expect(typeof decision.currentApr).toBe("number");
    expect(typeof decision.optimalApr).toBe("number");
  });

  test("does not execute when privateKey is null", async () => {
    mockSnapshots = [snapshot];
    await runSingleCycle(mockStore as any, pair, null);
    expect(executePRAMock).not.toHaveBeenCalled();
    expect(executeRSMock).not.toHaveBeenCalled();
  });

  test("decision has valid improvement field", async () => {
    mockSnapshots = [snapshot];
    const decision = await runSingleCycle(mockStore as any, pair, null);
    expect(typeof decision.improvement).toBe("number");
    expect(Number.isFinite(decision.improvement)).toBe(true);
  });

  test("persists pair allocation via O2 ingestion after cycle", async () => {
    mockSnapshots = [snapshot];
    await runSingleCycle(mockStore as any, pair, null);
    expect(lastIngestedAllocation).not.toBeNull();
    expect(typeof lastIngestedAllocation.decision).toBe("string");
    expect(["HOLD", "PRA", "RS"]).toContain(lastIngestedAllocation.decision);
  });

  test("increments epoch in runtime state", async () => {
    const rt = getPair(pair.id);
    const epochBefore = rt?.epoch ?? 0;
    mockSnapshots = [snapshot];
    await runSingleCycle(mockStore as any, pair, null);
    const rtAfter = getPair(pair.id);
    expect(rtAfter!.epoch).toBe(epochBefore + 1);
  });

  test("calls executePRA when decision is PRA and privateKey provided", async () => {
    mockSnapshots = [snapshot];
    const pk =
      "0x0000000000000000000000000000000000000000000000000000000000000001" as `0x${string}`;
    const decision = await runSingleCycle(mockStore as any, pair, pk);
    // No existing positions + positive optimalApr -> 100% improvement -> PRA
    expect(decision.type).toBe("PRA");
    expect(executePRAMock).toHaveBeenCalledTimes(1);
  });
});
