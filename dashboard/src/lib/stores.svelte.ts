import type {
  StrategySummary,
  StrategyStatus,
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
import { errMsg } from "@btr-supply/shared/format";
import { api } from "./api";

export type ViewType = "dashboard" | "config" | "docs";

class AppState {
  // View state
  view = $state<ViewType>("dashboard");

  // Strategy list (replaces pairs)
  strategies = $state<StrategySummary[]>([]);
  selectedStrategy = $state("");

  // Strategy detail
  status = $state<StrategyStatus | null>(null);
  positions = $state<Position[]>([]);
  allocation = $state<PairAllocation | null>(null);
  candles = $state<Candle[]>([]);
  txlog = $state<TxLogEntry[]>([]);
  optimalRanges = $state<OptimalRange[]>([]);

  // Range history for chart overlay
  rangeHistory = $state<{ ts: number; rangeMin: number; rangeMax: number }[]>([]);

  // Epoch snapshots (APR, TVL, PnL over time)
  epochSnapshots = $state<EpochSnapshot[]>([]);

  // Allocation history (time-series of allocation decisions)
  allocationHistory = $state<PairAllocation[]>([]);

  // Full pool analyses (for divergence chart)
  analyses = $state<PoolAnalysis[]>([]);

  // Cluster state
  cluster = $state<ClusterOverview | null>(null);

  // Config state
  configStrategies = $state<StrategyConfigEntry[]>([]);
  configDexs = $state<DexMetadata[]>([]);

  // UI state
  error = $state("");
  loading = $state(false);
  candleRange = $state(6 * 3600_000);
}

export const app = new AppState();

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let generation = 0;

export async function selectStrategy(name: string) {
  app.selectedStrategy = name;
  await refreshStrategyData(name, ++generation);
}


export function setView(view: ViewType) {
  app.view = view;
}

export function setCandleRange(ms: number) {
  app.candleRange = ms;
  if (app.selectedStrategy) refreshStrategyData(app.selectedStrategy, ++generation);
}

async function refreshStrategyData(name: string, gen = generation) {
  if (!name) return;
  app.loading = true;
  try {
    const now = Date.now();
    const range = app.candleRange;

    const [s, pos, alloc, c, tx, ranges, poolAnalyses, snapshots, allocHistory] = await Promise.all([
      api.strategyStatus(name).catch(() => null),
      api.strategyPositions(name).catch(() => [] as Position[]),
      api.strategyAllocations(name).catch(() => null as PairAllocation | null),
      api.strategyCandles(name, now - range, now).catch(() => [] as Candle[]),
      api.strategyTxlog(name, 50).catch(() => [] as TxLogEntry[]),
      api.strategyOptimalRanges(name).catch(() => [] as OptimalRange[]),
      api.strategyAnalyses(name, now - range, now).catch(() => [] as PoolAnalysis[]),
      api.strategySnapshots(name, now - range, now).catch(() => [] as EpochSnapshot[]),
      api.strategyAllocationsHistory(name, 500).catch(() => [] as PairAllocation[]),
    ]);
    if (gen !== generation) return;

    app.status = s ?? buildFallbackStatus(name, alloc);
    app.positions = pos;
    app.allocation = alloc;
    app.candles = c;
    app.txlog = tx;
    app.optimalRanges = ranges;
    app.analyses = poolAnalyses;

    // Deduplicate by ts (multiple pools share same timestamp) — take widest range per ts
    const rangeByTs = new Map<number, { ts: number; rangeMin: number; rangeMax: number }>();
    for (const a of poolAnalyses) {
      if (a.rangeMin <= 0 || a.rangeMax <= 0) continue;
      const existing = rangeByTs.get(a.ts);
      if (!existing) {
        rangeByTs.set(a.ts, { ts: a.ts, rangeMin: a.rangeMin, rangeMax: a.rangeMax });
      } else {
        existing.rangeMin = Math.min(existing.rangeMin, a.rangeMin);
        existing.rangeMax = Math.max(existing.rangeMax, a.rangeMax);
      }
    }
    app.rangeHistory = [...rangeByTs.values()];
    app.epochSnapshots = snapshots;
    app.allocationHistory = allocHistory;
    app.error = "";
  } catch (e) {
    if (gen !== generation) return;
    app.error = errMsg(e);
  } finally {
    app.loading = false;
  }
}

/** Build a minimal status object when the backend status endpoint is unavailable */
function buildFallbackStatus(name: string, alloc: PairAllocation | null) {
  // Try to find summary data from the strategy list
  const summary = app.strategies.find(s => s.name === name);
  return {
    id: name,
    name,
    pairId: summary?.pairId ?? name,
    epoch: summary?.epoch ?? 0,
    decision: alloc?.decision ?? summary?.decision ?? "HOLD",
    decisionTs: alloc?.ts ?? summary?.decisionTs ?? 0,
    forces: null,
    optimizer: { params: null, fitness: 0 },
    regime: null,
    killSwitch: null,
    status: summary?.status ?? "unknown",
    currentApr: alloc?.currentApr ?? summary?.apy ?? 0,
    optimalApr: alloc?.optimalApr ?? 0,
  };
}

export async function refreshCluster() {
  try {
    app.cluster = await api.cluster();
  } catch (e) {
    app.error = errMsg(e);
  }
}

export async function refreshConfig() {
  try {
    const [strats, dexs] = await Promise.all([api.configStrategies(), api.configDexs()]);
    app.configStrategies = strats;
    app.configDexs = dexs;
  } catch (e) {
    app.error = errMsg(e);
  }
}

export function startPolling(intervalMs = 30_000) {
  stopPolling();
  async function poll() {
    try {
      const s = await api.strategies();
      app.strategies = s;
      if (!app.selectedStrategy && s.length > 0) await selectStrategy(s[0].name);
      else if (app.selectedStrategy) await refreshStrategyData(app.selectedStrategy);

      await Promise.all([refreshCluster(), refreshConfig()]);
    } catch (e) {
      app.error = errMsg(e);
    }
    pollTimer = setTimeout(poll, intervalMs);
  }
  poll();
}

export function stopPolling() {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  generation++;
}
