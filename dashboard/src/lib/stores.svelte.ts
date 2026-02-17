import type {
  PairSummary,
  PairStatus,
  Position,
  PairAllocation,
  Candle,
  TxLogEntry,
} from "@btr-supply/shared/types";
import { errMsg } from "@btr-supply/shared/format";
import { api } from "./api";

class AppState {
  pairs = $state<PairSummary[]>([]);
  selectedPairId = $state("");
  status = $state<PairStatus | null>(null);
  positions = $state<Position[]>([]);
  allocation = $state<PairAllocation | null>(null);
  candles = $state<Candle[]>([]);
  txlog = $state<TxLogEntry[]>([]);
  error = $state("");
  loading = $state(false);
  candleRange = $state(24 * 3600_000);
}

export const app = new AppState();

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let generation = 0;

export async function selectPair(id: string) {
  app.selectedPairId = id;
  await refreshPairData(id, ++generation);
}

export function setCandleRange(ms: number) {
  app.candleRange = ms;
  if (app.selectedPairId) refreshPairData(app.selectedPairId, ++generation);
}

async function refreshPairData(id: string, gen = generation) {
  if (!id) return;
  app.loading = true;
  try {
    const now = Date.now();
    const range = app.candleRange;
    const [s, pos, alloc, c, tx] = await Promise.all([
      api.status(id),
      api.positions(id),
      api.allocations(id),
      api.candles(id, now - range, now),
      api.txlog(id, 50),
    ]);
    if (gen !== generation) return;
    app.status = s;
    app.positions = pos;
    app.allocation = alloc;
    app.candles = c;
    app.txlog = tx;
    app.error = "";
  } catch (e) {
    if (gen !== generation) return;
    app.error = errMsg(e);
  } finally {
    app.loading = false;
  }
}

export function startPolling(intervalMs = 30_000) {
  stopPolling();
  async function poll() {
    try {
      const p = await api.pairs();
      app.pairs = p;
      if (!app.selectedPairId && p.length > 0) await selectPair(p[0].id);
      else if (app.selectedPairId) await refreshPairData(app.selectedPairId);
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
