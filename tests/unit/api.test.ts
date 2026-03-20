import { describe, expect, test, beforeAll, afterAll, mock } from "bun:test";
import type { Server } from "bun";
import type { Position, TxLogEntry, PairAllocation } from "../../src/types";
import type { EpochSnapshot } from "../../shared/types";

const poolAddr = "0x0000000000000000000000000000000000000001" as `0x${string}`;

// ---- In-memory mock DragonflyStore ----

const mockStore = {
  getPositions: async () => [] as Position[],
  savePosition: async () => {},
  deletePosition: async () => {},
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

// ---- Mock store-o2 (required since api.ts imports it) ----

const now = Date.now();

// Mock store-o2 module
mock.module("../../src/data/store-o2", () => ({
  getCandles: mock(async () => []),
  getLastSnapshot: mock(async () => null),
  getPoolAnalyses: mock(async () => []),
  getLatestAnalysesForPools: mock(async () => []),
  getLatestPairAllocation: mock(async () => null),
  getPairAllocations: mock(async () => []),
  getTxLogs: mock(async () => []),
  getEpochSnapshots: mock(async () => []),
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
  registerPair("TEST-PAIR", mockStore as any, pairConfig);
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

// ---- 404 handling ----

describe("404 routes", () => {
  test("unknown route returns 404", async () => {
    const res = await fetch(url("/api/nonexistent"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Not found");
  });

  test("legacy pair routes return 404", async () => {
    const res = await fetch(url("/api/pairs/TEST-PAIR/status"));
    expect(res.status).toBe(404);
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
    const endpoints = ["/api/health", "/api/nonexistent"];

    for (const ep of endpoints) {
      const res = await fetch(url(ep));
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    }
  });
});

// ---- Strategy endpoints (standalone / non-orchestrated mode) ----

describe("GET /api/strategies", () => {
  test("returns 400 in standalone mode", async () => {
    const res = await fetch(url("/api/strategies"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Not in orchestrated mode");
  });

  test("includes CORS headers on error response", async () => {
    const res = await fetch(url("/api/strategies"));
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Content-Type")).toBe("application/json");
  });
});

describe("GET /api/strategies/:name/status", () => {
  test("returns 400 in standalone mode", async () => {
    const res = await fetch(url("/api/strategies/TEST-PAIR/status"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Not in orchestrated mode");
  });
});

describe("GET /api/strategies/:name/positions", () => {
  test("returns 400 in standalone mode", async () => {
    const res = await fetch(url("/api/strategies/TEST-PAIR/positions"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Not in orchestrated mode");
  });
});

describe("GET /api/strategies/:name/candles", () => {
  test("returns 400 in standalone mode", async () => {
    const res = await fetch(url("/api/strategies/TEST-PAIR/candles"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Not in orchestrated mode");
  });
});

describe("GET /api/strategies/:name/txlog", () => {
  test("returns 400 in standalone mode", async () => {
    const res = await fetch(url("/api/strategies/TEST-PAIR/txlog"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Not in orchestrated mode");
  });
});

describe("GET /api/strategies/:name/allocations", () => {
  test("returns 400 in standalone mode", async () => {
    const res = await fetch(url("/api/strategies/TEST-PAIR/allocations"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Not in orchestrated mode");
  });
});

describe("GET /api/strategies/:name/optimal-ranges", () => {
  test("returns 400 in standalone mode", async () => {
    const res = await fetch(url("/api/strategies/TEST-PAIR/optimal-ranges"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Not in orchestrated mode");
  });
});
