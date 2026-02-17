import { describe, expect, test, beforeAll, afterAll, mock } from "bun:test";
import type { Server } from "bun";
import type { Position, TxLogEntry, PairAllocation, PoolAnalysis } from "../../src/types";
import type { EpochSnapshot } from "../../shared/types";
import { silenceLog } from "../helpers";

// Silence log output during tests
beforeAll(silenceLog);

const poolAddr = "0x0000000000000000000000000000000000000001" as `0x${string}`;

// ---- In-memory mock DragonflyStore ----

const positionsMap = new Map<string, Position>();

const mockStore = {
  getPositions: async () => [...positionsMap.values()],
  savePosition: async (p: Position) => { positionsMap.set(p.id, p); },
  deletePosition: async (id: string) => { positionsMap.delete(id); },
  getOptimizerState: async () => null,
  saveOptimizerState: async () => {},
  getEpoch: async () => 2,
  incrementEpoch: async () => 3,
  getRegimeSuppressUntil: async () => 0,
  setRegimeSuppressUntil: async () => {},
  getLatestCandleTs: async () => 0,
  setLatestCandleTs: async () => {},
  deleteAll: async () => {},
};

// ---- Mock store-o2 to return seeded data ----

const now = Date.now();

const seededAllocations: PairAllocation[] = [
  {
    ts: now,
    currentApr: 0.1,
    optimalApr: 0.12,
    improvement: 0.2,
    decision: "HOLD",
    targetAllocations: [{ pool: poolAddr, chain: 1, dex: "uniswap_v3", pct: 1, expectedApr: 0.12 }],
    currentAllocations: [],
  },
  {
    ts: now - 60000,
    currentApr: 0.08,
    optimalApr: 0.1,
    improvement: 0.25,
    decision: "PRA",
    targetAllocations: [{ pool: poolAddr, chain: 1, dex: "uniswap_v3", pct: 1, expectedApr: 0.1 }],
    currentAllocations: [],
  },
];

const seededCandles = [
  { ts: now - 60000, o: 1.0, h: 1.01, l: 0.99, c: 1.005, v: 500 },
  { ts: now, o: 1.005, h: 1.015, l: 0.995, c: 1.01, v: 600 },
];

const seededTxLogs: TxLogEntry[] = [
  {
    ts: now,
    decisionType: "PRA",
    opType: "mint",
    pool: poolAddr,
    chain: 1,
    txHash: "0x0000000000000000000000000000000000000000000000000000000000000abc",
    status: "success",
    gasUsed: 150000n,
    gasPrice: 20000000000n,
    inputToken: "USDC",
    inputAmount: "1000000",
    inputUsd: 1000,
    outputToken: "USDT",
    outputAmount: "999000",
    outputUsd: 999,
    targetAllocationPct: 1.0,
    actualAllocationPct: 0.98,
    allocationErrorPct: 0.02,
  },
];

const seededSnapshots: EpochSnapshot[] = [
  {
    pairId: "TEST-PAIR",
    epoch: 1,
    ts: now - 120000,
    decision: "PRA",
    portfolioValueUsd: 5000,
    feesEarnedUsd: 0,
    gasSpentUsd: 0,
    ilUsd: 0,
    netPnlUsd: 0,
    rangeEfficiency: 0,
    currentApr: 0.08,
    optimalApr: 0.1,
    positionsCount: 1,
  },
  {
    pairId: "TEST-PAIR",
    epoch: 2,
    ts: now - 60000,
    decision: "HOLD",
    portfolioValueUsd: 5100,
    feesEarnedUsd: 0,
    gasSpentUsd: 0,
    ilUsd: 0,
    netPnlUsd: 0,
    rangeEfficiency: 0,
    currentApr: 0.1,
    optimalApr: 0.12,
    positionsCount: 1,
  },
];

// Mock store-o2 module
mock.module("../../src/data/store-o2", () => ({
  getCandles: mock(async (_pair: string, from: number, to: number) => {
    return seededCandles.filter((c) => c.ts >= from && c.ts <= to);
  }),
  getLastSnapshot: mock(async () => null),
  getPoolAnalyses: mock(async () => []),
  getLatestAnalysesForPools: mock(async () => []),
  getLatestPairAllocation: mock(async (pairId: string) => {
    if (pairId !== "TEST-PAIR") return null;
    return seededAllocations[0];
  }),
  getPairAllocations: mock(async (pairId: string, limit = 50) => {
    if (pairId !== "TEST-PAIR") return [];
    return seededAllocations.slice(0, limit);
  }),
  getTxLogs: mock(async (pairId: string, limit = 50) => {
    if (pairId !== "TEST-PAIR") return [];
    return seededTxLogs.slice(0, limit);
  }),
  getEpochSnapshots: mock(async (pairId: string, from?: number, to?: number, limit?: number) => {
    if (pairId !== "TEST-PAIR") return [];
    let results = [...seededSnapshots];
    if (from !== undefined) results = results.filter((s) => s.ts >= from);
    if (to !== undefined) results = results.filter((s) => s.ts <= to);
    if (limit !== undefined) results = results.slice(0, limit);
    return results;
  }),
  getRecentYields: mock(async () => []),
  getRecentRsTimestamps: mock(async () => []),
  getTrailingTxCount: mock(async () => 0),
}));

const { registerPair } = await import("../../src/state");
const { startApi } = await import("../../src/api");

let server: Server;
let port: number;

const pairConfig = {
  id: "TEST-PAIR",
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
  eoaEnvVar: "PK_TEST",
  pools: [{ address: poolAddr, chain: 1, dex: "uniswap_v3" }],
  intervalSec: 900,
  maxPositions: 3,
  thresholds: { pra: 0.05, rs: 0.25 },
};

beforeAll(() => {
  // Register pair with mock store
  registerPair("TEST-PAIR", mockStore as any, pairConfig);

  // Start on random port (0 = OS-assigned)
  server = startApi(0);
  port = server.port;
});

afterAll(() => {
  server.stop(true);
});

function url(path: string) {
  return `http://localhost:${port}${path}`;
}

// ---- Health endpoint ----

describe("GET /api/health", () => {
  test("returns ok and pair list", async () => {
    const res = await fetch(url("/api/health"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.uptime).toBeGreaterThanOrEqual(0);
    expect(body.pairs).toContain("TEST-PAIR");
  });

  test("has CORS headers", async () => {
    const res = await fetch(url("/api/health"));
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
    expect(res.headers.get("Content-Type")).toBe("application/json");
  });
});

// ---- Pairs endpoint ----

describe("GET /api/pairs", () => {
  test("returns pair list with summary", async () => {
    const res = await fetch(url("/api/pairs"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBeGreaterThanOrEqual(1);

    const pair = body.find((p: any) => p.id === "TEST-PAIR");
    expect(pair).toBeDefined();
    expect(pair.id).toBe("TEST-PAIR");
    expect(typeof pair.positions).toBe("number");
    expect(typeof pair.epoch).toBe("number");
  });
});

// ---- Pair sub-endpoints ----

describe("GET /api/pairs/:id/status", () => {
  test("returns pair status", async () => {
    const res = await fetch(url("/api/pairs/TEST-PAIR/status"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("TEST-PAIR");
    expect(typeof body.epoch).toBe("number");
    expect(body.decision).toBeDefined();
    expect(body.optimizer).toBeDefined();
    expect(body.optimizer.params).toBeDefined();
  });
});

describe("GET /api/pairs/:id/positions", () => {
  test("returns empty positions array when no positions", async () => {
    positionsMap.clear();
    const res = await fetch(url("/api/pairs/TEST-PAIR/positions"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(0);
  });

  test("returns positions when they exist", async () => {
    // Add a position via mock store
    await mockStore.savePosition({
      id: "api-test-pos",
      pool: poolAddr,
      chain: 1,
      dex: "uniswap_v3",
      positionId: "42",
      tickLower: -100,
      tickUpper: 100,
      liquidity: 5000n,
      amount0: 2500n,
      amount1: 2500n,
      entryPrice: 1.0,
      entryTs: Date.now(),
      entryApr: 0.15,
      entryValueUsd: 5000,
    });

    const res = await fetch(url("/api/pairs/TEST-PAIR/positions"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBeGreaterThanOrEqual(1);
    const pos = body.find((p: any) => p.id === "api-test-pos");
    expect(pos).toBeDefined();
    expect(pos.pool).toBe(poolAddr);
  });
});

describe("GET /api/pairs/:id/allocations", () => {
  test("returns latest pair allocation without limit", async () => {
    const res = await fetch(url("/api/pairs/TEST-PAIR/allocations"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).not.toBeNull();
    expect(body.decision).toBe("HOLD");
    expect(body.currentApr).toBe(0.1);
    expect(body.optimalApr).toBe(0.12);
    expect(body.targetAllocations).toHaveLength(1);
  });

  test("returns historical allocations with limit", async () => {
    const res = await fetch(url("/api/pairs/TEST-PAIR/allocations?limit=10"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBeGreaterThanOrEqual(2);
    // DESC order: newest first
    expect(body[0].decision).toBe("HOLD");
    expect(body[1].decision).toBe("PRA");
  });

  test("limit=1 returns only the most recent allocation", async () => {
    const res = await fetch(url("/api/pairs/TEST-PAIR/allocations?limit=1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].decision).toBe("HOLD");
  });
});

describe("GET /api/pairs/:id/snapshots", () => {
  test("returns all epoch snapshots", async () => {
    const res = await fetch(url("/api/pairs/TEST-PAIR/snapshots"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body[0].epoch).toBe(1);
    expect(body[1].epoch).toBe(2);
    expect(body[0].pairId).toBe("TEST-PAIR");
  });

  test("filters by from/to timestamps", async () => {
    const res = await fetch(url(`/api/pairs/TEST-PAIR/snapshots?from=${now - 90000}&to=${now}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].epoch).toBe(2);
  });

  test("respects limit parameter", async () => {
    const res = await fetch(url("/api/pairs/TEST-PAIR/snapshots?limit=1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].epoch).toBe(1); // ASC order, first epoch
  });

  test("returns empty for unknown pair", async () => {
    const res = await fetch(url("/api/pairs/TEST-PAIR/snapshots?from=999999999999999"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(0);
  });
});

describe("GET /api/pairs/:id/candles", () => {
  test("returns candles with default time range", async () => {
    const res = await fetch(url("/api/pairs/TEST-PAIR/candles"));
    expect(res.status).toBe(200);
    const body = await res.json();
    // Seeded 2 candles within the last 24h
    expect(body.length).toBeGreaterThanOrEqual(1);
  });

  test("respects from/to query params", async () => {
    const res = await fetch(
      url(`/api/pairs/TEST-PAIR/candles?from=${now - 30000}&to=${now + 30000}`),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBeGreaterThanOrEqual(1);
  });
});

describe("GET /api/pairs/:id/txlog", () => {
  test("returns tx logs", async () => {
    const res = await fetch(url("/api/pairs/TEST-PAIR/txlog"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body[0].opType).toBe("mint");
  });

  test("respects limit query param", async () => {
    const res = await fetch(url("/api/pairs/TEST-PAIR/txlog?limit=1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
  });
});

// ---- 404 handling ----

describe("404 routes", () => {
  test("unknown route returns 404", async () => {
    const res = await fetch(url("/api/nonexistent"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Not found");
  });

  test("unknown pair returns 404", async () => {
    const res = await fetch(url("/api/pairs/FAKE-PAIR/status"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Pair not found");
  });

  test("unknown sub-endpoint for valid pair returns 404", async () => {
    const res = await fetch(url("/api/pairs/TEST-PAIR/nonexistent"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Not found");
  });
});

// ---- CORS ----

describe("CORS", () => {
  test("OPTIONS request returns CORS headers with 200", async () => {
    const res = await fetch(url("/api/health"), { method: "OPTIONS" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
    expect(res.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type, Authorization");
  });

  test("all JSON responses include CORS headers", async () => {
    const endpoints = [
      "/api/health",
      "/api/pairs",
      "/api/pairs/TEST-PAIR/status",
      "/api/pairs/TEST-PAIR/positions",
    ];

    for (const ep of endpoints) {
      const res = await fetch(url(ep));
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    }
  });
});

// ---- Analyses endpoint ----

describe("GET /api/pairs/:id/analyses", () => {
  test("returns empty analyses when no data", async () => {
    const res = await fetch(url("/api/pairs/TEST-PAIR/analyses"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(0);
  });

  test("filters by pool and chain query params", async () => {
    const res = await fetch(url(`/api/pairs/TEST-PAIR/analyses?pool=${poolAddr}&chain=1`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(0);
  });
});
