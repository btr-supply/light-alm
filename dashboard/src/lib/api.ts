import type {
  PairSummary,
  PairStatus,
  Position,
  PairAllocation,
  Candle,
  TxLogEntry,
} from "@btr-supply/shared/types";

const BASE = "/api";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

export const api = {
  health: () => get<{ ok: boolean; uptime: number; pairs: string[] }>("/health"),
  pairs: () => get<PairSummary[]>("/pairs"),
  status: (id: string) => get<PairStatus>(`/pairs/${id}/status`),
  positions: (id: string) => get<Position[]>(`/pairs/${id}/positions`),
  allocations: (id: string) => get<PairAllocation | null>(`/pairs/${id}/allocations`),
  candles: (id: string, from: number, to: number) =>
    get<Candle[]>(`/pairs/${id}/candles?from=${from}&to=${to}`),
  txlog: (id: string, limit = 50) => get<TxLogEntry[]>(`/pairs/${id}/txlog?limit=${limit}`),
};
