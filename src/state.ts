import type {
  PairConfig,
  StrategyConfig,
  Forces,
  DecisionType,
  RegimeState,
  RangeParams,
  Candle,
  AllocationEntry,
} from "./types";
import type { OptimalRange } from "../shared/types";
import type { DragonflyStore } from "./data/store-dragonfly";

export interface PairRuntime {
  store: DragonflyStore;
  config: PairConfig | StrategyConfig;
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
  targetAllocations: AllocationEntry[];
  optimalRanges: OptimalRange[];
}

/** Shared base fields for all DragonflyDB-published worker states. */
interface BaseWorkerState {
  pairId: string;
  pid: number;
  status: "running" | "error" | "stopped";
  uptimeMs: number;
  errorMsg?: string;
}

/** Wire format for collector state published to DragonflyDB. */
export interface CollectorState extends BaseWorkerState {
  lastCollectTs: number;
  candleCount: number;
  snapshotCount: number;
}

/** Wire format for worker state published to DragonflyDB. */
export interface WorkerState extends BaseWorkerState {
  strategyName: string;
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
  targetAllocations: AllocationEntry[];
  optimalRanges: OptimalRange[];
}

/** Extract publishable WorkerState from a PairRuntime. */
export function toWorkerState(
  strategyName: string,
  pairId: string,
  rt: PairRuntime,
  pid: number,
  startTs: number,
  errorMsg?: string,
): WorkerState {
  return {
    pairId,
    strategyName,
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
    targetAllocations: rt.targetAllocations,
    optimalRanges: rt.optimalRanges,
    errorMsg,
  };
}

/** Extract publishable CollectorState from runtime values. */
export function toCollectorState(
  pairId: string,
  pid: number,
  startTs: number,
  status: CollectorState["status"],
  lastCollectTs: number,
  candleCount: number,
  snapshotCount: number,
  errorMsg?: string,
): CollectorState {
  return {
    pairId,
    pid,
    status,
    uptimeMs: Date.now() - startTs,
    lastCollectTs,
    candleCount,
    snapshotCount,
    errorMsg,
  };
}

// ---- In-memory registry (used by CLI mode + worker-local state) ----

const registry = new Map<string, PairRuntime>();

export function registerPair(
  id: string,
  store: DragonflyStore,
  config: PairConfig | StrategyConfig,
): PairRuntime {
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
    targetAllocations: [],
    optimalRanges: [],
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
