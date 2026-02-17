import type { Database } from "bun:sqlite";
import type { PairConfig, Forces, DecisionType, RegimeState, RangeParams } from "./types";

export interface PairRuntime {
  db: Database;
  config: PairConfig;
  epoch: number;
  regimeSuppressUntil: number;
  lastDecision: DecisionType;
  lastDecisionTs: number;
  forces: Forces | null;
  optParams: RangeParams | null;
  optFitness: number;
  regime: RegimeState | null;
  killSwitch: { active: boolean; reason: string } | null;
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
  apr?: { current: number; optimal: number },
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
    currentApr: apr?.current ?? 0,
    optimalApr: apr?.optimal ?? 0,
    errorMsg,
  };
}

// ---- In-memory registry (used by CLI mode + worker-local state) ----

const registry = new Map<string, PairRuntime>();

export function registerPair(id: string, db: Database, config: PairConfig): PairRuntime {
  const rt: PairRuntime = {
    db,
    config,
    epoch: 0,
    regimeSuppressUntil: 0,
    lastDecision: "HOLD",
    lastDecisionTs: 0,
    forces: null,
    optParams: null,
    optFitness: 0,
    regime: null,
    killSwitch: null,
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
