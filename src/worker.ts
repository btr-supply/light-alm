import { DragonflyStore } from "./data/store-dragonfly";
import { startPairLoop, stopAllLoops } from "./scheduler";
import { registerPair, getPair, toWorkerState } from "./state";
import { WORKER_LOCK_TTL, WORKER_HEARTBEAT_INTERVAL, WORKER_HEARTBEAT_TTL } from "./config/params";
import { log, isValidLogLevel, errMsg } from "./utils";
import { configEntryToPair, loadPairConfigs } from "./config/pairs";
import {
  createRedis,
  KEYS,
  CHANNELS,
  acquireLock,
  refreshLock,
  releaseLock,
  setWorkerState,
  getConfigPair,
} from "./infra/redis";

const _pairId = process.argv[2] || process.env.WORKER_PAIR_ID;
if (!_pairId) {
  console.error("Usage: bun src/worker.ts <pairId>");
  process.exit(1);
}
const pairId: string = _pairId;

// Set WORKER_PAIR_ID for logger process name
process.env.WORKER_PAIR_ID = pairId;

const level = process.env.LOG_LEVEL || "info";
if (isValidLogLevel(level)) log.setLevel(level);

const startTs = Date.now();
const lockValue = `${process.pid}:${startTs}`;

async function main() {
  // Connect to DragonflyDB first — config lives here
  const redis = createRedis();

  // Load pair config from DragonflyDB (source of truth), fallback to env
  const configEntry = await getConfigPair(redis, pairId);
  const pair = configEntry
    ? configEntryToPair(configEntry)
    : loadPairConfigs().find((p) => p.id === pairId) ?? null;
  if (!pair) {
    log.error(`Pair ${pairId} not found in DragonflyDB or env config`);
    redis.close();
    process.exit(1);
  }

  // Acquire worker lock
  const lockKey = KEYS.workerLock(pairId);
  const acquired = await acquireLock(redis, lockKey, lockValue, WORKER_LOCK_TTL);
  if (!acquired) {
    log.error(`Strategy ${pairId} already locked by another worker`);
    redis.close();
    process.exit(1);
  }
  log.info(`Worker ${pairId} acquired lock (pid=${process.pid})`, { pairId });

  // Create DragonflyDB store for this pair
  const store = new DragonflyStore(redis, pairId);
  const pk = (process.env[pair.eoaEnvVar] as `0x${string}` | undefined) ?? null;

  if (!pk) {
    log.warn(`No private key for ${pairId} (set ${pair.eoaEnvVar}), running in read-only mode`);
  }

  // Register in local state (for scheduler access)
  registerPair(pairId, store, pair);

  // Graceful shutdown (defined early so heartbeat can trigger it)
  let shutdownCalled = false;
  async function shutdown() {
    if (shutdownCalled) return;
    shutdownCalled = true;
    log.info(`Worker ${pairId} shutting down...`, { pairId });
    clearInterval(heartbeatInterval);
    stopAllLoops();

    try {
      const rt = getPair(pairId);
      if (rt) {
        const state = toWorkerState(pairId, rt, process.pid, startTs);
        state.status = "stopped";
        await setWorkerState(redis, pairId, state);
      }
      await releaseLock(redis, lockKey, lockValue);
      await redis.del(KEYS.workerHeartbeat(pairId));
    } catch {
      // Best-effort cleanup
    }

    await log.shutdown();

    try {
      if (sub) sub.close();
      redis.close();
    } catch {
      // Already disconnected
    }
    process.exit(0);
  }

  // Register signal handlers early (before startPairLoop)
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Heartbeat + lock refresh interval
  const heartbeatInterval = setInterval(async () => {
    try {
      await redis.set(KEYS.workerHeartbeat(pairId), String(Date.now()), "PX", WORKER_HEARTBEAT_TTL);
      const stillOwned = await refreshLock(redis, lockKey, lockValue, WORKER_LOCK_TTL);
      if (!stillOwned) {
        log.error(`${pairId}: lost worker lock — shutting down to prevent split-brain`);
        shutdown();
        return;
      }
      // Publish current state (APR cached in PairRuntime by scheduler)
      const rt = getPair(pairId);
      if (rt) {
        const state = toWorkerState(pairId, rt, process.pid, startTs);
        await setWorkerState(redis, pairId, state);
      }
    } catch (e) {
      log.warn(`${pairId}: heartbeat failed: ${errMsg(e)}`);
    }
  }, WORKER_HEARTBEAT_INTERVAL);

  // Initial heartbeat
  await redis.set(KEYS.workerHeartbeat(pairId), String(Date.now()), "PX", WORKER_HEARTBEAT_TTL);

  // Subscribe to control channel with reconnection
  let sub: typeof redis;
  async function connectSubscriber() {
    try {
      if (sub) {
        try {
          sub.close();
        } catch {}
      }
      sub = await redis.duplicate();
      await sub.subscribe(CHANNELS.control, (message: string) => {
        try {
          const cmd = JSON.parse(message);
          if (cmd.type === "SHUTDOWN" && (!cmd.pairId || cmd.pairId === pairId)) {
            log.info(`${pairId}: received SHUTDOWN command`, { pairId });
            shutdown();
          } else if (cmd.type === "RESTART" && cmd.pairId === pairId) {
            log.info(`${pairId}: received RESTART command`, { pairId });
            // Signal orchestrator to skip backoff and respawn immediately
            redis.set(KEYS.workerRestarting(pairId), "1", "PX", 60_000).finally(shutdown);
          }
        } catch {
          // Ignore malformed messages
        }
      });
    } catch (e) {
      log.warn(`${pairId}: subscriber setup failed: ${errMsg(e)}, retrying in 15s`);
      setTimeout(connectSubscriber, 15_000);
    }
  }
  await connectSubscriber();

  // Start the scheduler loop
  startPairLoop(store, pair, pk);
  log.info(`Worker ${pairId} started (pid=${process.pid})`, { pairId });
}

main().catch(async (e) => {
  log.error(`Worker ${pairId} fatal: ${errMsg(e)}`, { pairId });
  await log.shutdown();
  process.exitCode = 1;
});
