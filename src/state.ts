import type { PairConfig, Forces, DecisionType, RegimeState, RangeParams, Candle } from "./types";
import type { DragonflyStore } from "./data/store-dragonfly";

export interface PairRuntime {
  store: DragonflyStore;
  config: PairConfig;
  candles: Candle[];
  epoch: number;
  regimeSuppressUntil: number;
  lastDecision: DecisionType;
  lastDecisionTs: number;
  forces: Forces | null;
  optParams: RangeParams | null;
  optFitness: number;
  regime: RegimeState | null;
  killSwitch: { active: boolean; reason: string } | null;
  currentApr: number;
  optimalApr: number;
}

/** Wire format for worker state published to DragonflyDB. */
export interface WorkerState {
  pairId: string;
  pid: number;
  status: "running" | "error" | "stopped";
  uptimeMs: number;
  epoch: number;
  lastDecision: DecisionType;
  lastDecisionTs: number;
  forces: Forces | null;
  optParams: RangeParams | null;
  optFitness: number;
  regime: RegimeState | null;
  killSwitch: { active: boolean; reason: string } | null;
  currentApr: number;
  optimalApr: number;
  errorMsg?: string;
}

/** Extract publishable WorkerState from a PairRuntime. */
export function toWorkerState(
  pairId: string,
  rt: PairRuntime,
  pid: number,
  startTs: number,
  errorMsg?: string,
): WorkerState {
  return {
    pairId,
    pid,
    status: errorMsg ? "error" : "running",
    uptimeMs: Date.now() - startTs,
    epoch: rt.epoch,
    lastDecision: rt.lastDecision,
    lastDecisionTs: rt.lastDecisionTs,
    forces: rt.forces,
    optParams: rt.optParams,
    optFitness: rt.optFitness,
    regime: rt.regime,
    killSwitch: rt.killSwitch,
    currentApr: rt.currentApr,
    optimalApr: rt.optimalApr,
    errorMsg,
  };
}

// ---- In-memory registry (used by CLI mode + worker-local state) ----

const registry = new Map<string, PairRuntime>();

export function registerPair(id: string, store: DragonflyStore, config: PairConfig): PairRuntime {
  const rt: PairRuntime = {
    store,
    config,
    candles: [],
    epoch: 0,
    regimeSuppressUntil: 0,
    lastDecision: "HOLD",
    lastDecisionTs: 0,
    forces: null,
    optParams: null,
    optFitness: 0,
    regime: null,
    killSwitch: null,
    currentApr: 0,
    optimalApr: 0,
  };
  registry.set(id, rt);
  return rt;
}

export function getPair(id: string) {
  return registry.get(id);
}
export function allPairIds() {
  return [...registry.keys()];
}
export function allPairs() {
  return registry;
}
