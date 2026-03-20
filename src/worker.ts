/**
 * Strategy runner worker — executes a trading strategy.
 * Reads collected data from shared DragonflyDB keys written by the collector for the same pair.
 * Multiple strategy runners can operate on the same pair (e.g., V1 and V2 strategies).
 */
import { DragonflyStore } from "./data/store-dragonfly";
import { startPairLoop, stopAllLoops } from "./scheduler";
import { registerPair, getPair, toWorkerState } from "./state";
import { log } from "./utils";
import { WORKER_HEARTBEAT_TTL } from "./config/params";
import { KEYS, setWorkerState } from "./infra/redis";
import {
  bootstrapWorker,
  startHeartbeat,
  subscribeControl,
  cleanupWorker,
  loadWorkerStrategyConfig,
} from "./worker-base";

const ctx = await bootstrapWorker("strategy", 2, "WORKER_STRATEGY_NAME", (name) => ({
  lock: KEYS.workerLock(name),
  heartbeat: KEYS.workerHeartbeat(name),
  restarting: KEYS.workerRestarting(name),
}));

const strategyName = ctx.pairId; // bootstrapWorker puts the arg into pairId; for strategies it's the name
ctx.strategyName = strategyName;
const { redis, startTs } = ctx;
const strategy = await loadWorkerStrategyConfig(
  redis,
  strategyName,
  `Strategy runner ${strategyName}`,
);
const pairId = strategy.pairId;
ctx.pairId = pairId;

const store = new DragonflyStore(redis, strategyName, "btr:strategy");
const pk = (process.env[strategy.pkEnvVar] as `0x${string}` | undefined) ?? null;

if (!pk) {
  log.warn(
    `No private key for strategy ${strategyName} (${strategy.pkEnvVar}), running in read-only mode`,
  );
}

registerPair(strategyName, store, strategy);

let sub: Awaited<ReturnType<typeof subscribeControl>> | null = null;
let heartbeatInterval: ReturnType<typeof setInterval>;
let shutdownCalled = false;

async function shutdown() {
  if (shutdownCalled) return;
  shutdownCalled = true;
  log.info(`Strategy runner ${strategyName} shutting down...`, { pairId });
  clearInterval(heartbeatInterval);
  stopAllLoops();

  try {
    const rt = getPair(strategyName);
    if (rt) {
      const state = toWorkerState(strategyName, pairId, rt, process.pid, startTs);
      state.status = "stopped";
      await setWorkerState(redis, strategyName, state);
    }
  } catch {
    /* best-effort */
  }

  await cleanupWorker(ctx, sub);
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Heartbeat publishes worker state
heartbeatInterval = startHeartbeat(ctx, async () => {
  const rt = getPair(strategyName);
  if (rt) {
    const state = toWorkerState(strategyName, pairId, rt, process.pid, startTs);
    await setWorkerState(redis, strategyName, state);
  }
});

await redis.set(KEYS.workerHeartbeat(strategyName), String(Date.now()), "PX", WORKER_HEARTBEAT_TTL);
sub = await subscribeControl(ctx, "RESTART_STRATEGY", shutdown);

// Start scheduler — pass redis for reading collector data (keyed by pairId)
startPairLoop(store, strategy, pk, redis);
log.info(`Strategy runner ${strategyName} started (pair=${pairId}, pid=${process.pid})`, {
  pairId,
});
