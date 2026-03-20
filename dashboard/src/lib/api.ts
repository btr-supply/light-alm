import type {
  StrategySummary,
  StrategyConfigEntry,
  DexMetadata,
  ClusterOverview,
  OptimalRange,
  Position,
  PairAllocation,
  Candle,
  TxLogEntry,
  PoolAnalysis,
  EpochSnapshot,
} from "@btr-supply/shared/types";

const BASE = "/api";

async function apiError(res: Response, path: string): Promise<never> {
  let detail = "";
  try { const body = await res.json(); detail = body?.error ?? body?.message ?? ""; } catch {}
  throw new Error(detail ? `API ${res.status}: ${detail}` : `API ${res.status}: ${path}`);
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) return apiError(res, path);
  return res.json();
}

function authHeaders(): HeadersInit {
  const token = localStorage.getItem("apiToken");
  return token
    ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) return apiError(res, path);
  return res.json();
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) return apiError(res, path);
  return res.json();
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: "DELETE", headers: authHeaders() });
  if (!res.ok) return apiError(res, path);
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  health: () => get<{ ok: boolean; uptime: number; pairs: string[] }>("/health"),

  // Strategy endpoints
  strategies: () => get<StrategySummary[]>("/strategies"),
  strategyStatus: (name: string) => get<any>(`/strategies/${name}/status`),
  strategyPositions: (name: string) => get<Position[]>(`/strategies/${name}/positions`),
  strategyAllocations: (name: string) => get<PairAllocation | null>(`/strategies/${name}/allocations`),
  strategyCandles: (name: string, from: number, to: number) =>
    get<Candle[]>(`/strategies/${name}/candles?from=${from}&to=${to}`),
  strategyTxlog: (name: string, limit = 50) =>
    get<TxLogEntry[]>(`/strategies/${name}/txlog?limit=${limit}`),
  strategyOptimalRanges: (name: string) =>
    get<OptimalRange[]>(`/strategies/${name}/optimal-ranges`),
  strategyAnalyses: (name: string, from: number, to: number) =>
    get<PoolAnalysis[]>(`/strategies/${name}/analyses?from=${from}&to=${to}`),
  strategySnapshots: (name: string, from: number, to: number, limit?: number) =>
    get<EpochSnapshot[]>(`/strategies/${name}/snapshots?from=${from}&to=${to}${limit ? `&limit=${limit}` : ""}`),
  strategyAllocationsHistory: (name: string, limit = 500) =>
    get<PairAllocation[]>(`/strategies/${name}/allocations?limit=${limit}`),

  // Cluster
  cluster: () => get<ClusterOverview>("/cluster"),

  // Config CRUD
  configStrategies: () => get<StrategyConfigEntry[]>("/config/strategies"),
  configStrategy: (name: string) => get<StrategyConfigEntry>(`/config/strategies/${name}`),
  saveConfigStrategy: (name: string, body: StrategyConfigEntry) =>
    put<{ ok: boolean }>(`/config/strategies/${name}`, body),
  deleteConfigStrategy: (name: string) => del<{ ok: boolean }>(`/config/strategies/${name}`),

  configDexs: () => get<DexMetadata[]>("/config/dexs"),
  configDex: (id: string) => get<DexMetadata>(`/config/dexs/${id}`),
  saveConfigDex: (id: string, body: DexMetadata) =>
    put<{ ok: boolean }>(`/config/dexs/${id}`, body),
  deleteConfigDex: (id: string) => del<{ ok: boolean }>(`/config/dexs/${id}`),

  configPools: (pairId: string) =>
    get<{ chain: number; address: string; dex: string }[]>(`/config/pools/${pairId}`),
  saveConfigPools: (pairId: string, pools: { chain: number; address: string; dex: string }[]) =>
    put<{ ok: boolean }>(`/config/pools/${pairId}`, { pools }),
  deleteConfigPools: (pairId: string) => del<{ ok: boolean }>(`/config/pools/${pairId}`),

  configRpcs: () => get<Record<number, { rpcs: string[]; source: string }>>("/config/rpcs"),
  saveConfigRpc: (chainId: number, rpcs: string[]) =>
    put<{ ok: boolean }>(`/config/rpcs/${chainId}`, { rpcs }),
  deleteConfigRpc: (chainId: number) => del<{ ok: boolean }>(`/config/rpcs/${chainId}`),

  // Orchestrator control
  startStrategy: (name: string) => post<{ ok: boolean }>(`/orchestrator/strategies/${name}/start`),
  stopStrategy: (name: string) => post<{ ok: boolean }>(`/orchestrator/strategies/${name}/stop`),
  pauseStrategy: (name: string) => post<{ ok: boolean }>(`/orchestrator/strategies/${name}/pause`),
  restartStrategy: (name: string) =>
    post<{ ok: boolean }>(`/orchestrator/strategies/${name}/restart`),
  startCollector: (pairId: string) =>
    post<{ ok: boolean }>(`/orchestrator/collectors/${pairId}/start`),
  stopCollector: (pairId: string) =>
    post<{ ok: boolean }>(`/orchestrator/collectors/${pairId}/stop`),
  restartCollector: (pairId: string) =>
    post<{ ok: boolean }>(`/orchestrator/collectors/${pairId}/restart`),
};
