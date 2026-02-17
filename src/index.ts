import { initPairStore, getPositions } from "./data/store";
import { runSingleCycle } from "./scheduler";
import { registerPair } from "./state";
import { log, isValidLogLevel, pct, errMsg } from "./utils";
import { loadPairConfigs } from "./config/pairs";
import { createRedis, KEYS, getWorkerState } from "./infra/redis";

// ---- Main ----

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "run";

  if (command === "--help" || command === "-h") {
    console.log(`
BTR Agentic ALM - Autonomous Liquidity Manager

Usage: bun src/index.ts [command]

Commands:
  run       Start the orchestrator (spawns workers + API server)
  status    Show current positions and metrics
  cycle     Run a single cycle for all pairs (no orchestration)

Environment:
  PAIRS              Comma-separated pair IDs (default: USDC-USDT)
  POOLS_USDC_USDT    Pool configs: chain:address:dex,...
  PK_USDC_USDT       Private key for USDC-USDT EOA
  INTERVAL_SEC       Cycle interval in seconds (default: 900)
  MAX_POSITIONS      Max positions per pair (default: 3)
  PRA_THRESHOLD      Pool re-allocation threshold (default: 0.05)
  RS_THRESHOLD       Range-shift threshold (default: 0.25)
  API_PORT           API server port (default: 3001)
  LOG_LEVEL          Log level: debug|info|warn|error (default: info)
  DRAGONFLY_URL      DragonflyDB connection (default: redis://localhost:6379)
  O2_URL             OpenObserve URL (optional)
  O2_ORG             OpenObserve organization (default: default)
  O2_TOKEN           OpenObserve auth token (optional)
`);
    return;
  }

  const level = process.env.LOG_LEVEL || "info";
  if (isValidLogLevel(level)) {
    log.setLevel(level);
  } else {
    log.warn(`Invalid LOG_LEVEL "${level}", using default "info"`);
  }

  // ---- run: delegate to orchestrator ----
  if (command === "run") {
    log.info("Starting orchestrator...");
    const orchestratorPath = new URL("orchestrator.ts", import.meta.url).pathname;
    const proc = Bun.spawn(["bun", orchestratorPath], {
      env: process.env,
      stdout: "inherit",
      stderr: "inherit",
    });

    // Forward signals to orchestrator
    const forward = () => proc.kill();
    process.on("SIGINT", forward);
    process.on("SIGTERM", forward);

    await proc.exited;
    process.exitCode = proc.exitCode ?? 0;
    return;
  }

  // ---- status: read from DragonflyDB with SQLite fallback ----
  if (command === "status") {
    const pairs = loadPairConfigs();
    if (!pairs.length) {
      log.error("No pairs configured.");
      process.exitCode = 1;
      return;
    }

    // Try DragonflyDB first
    let usedRedis = false;
    try {
      const redis = createRedis();
      const pairIds = await redis.smembers(KEYS.workers);
      if (pairIds.length) {
        usedRedis = true;
        for (const id of pairIds) {
          const state = await getWorkerState(redis, id);
          const hb = await redis.get(KEYS.workerHeartbeat(id));
          console.log(
            `\n${id}: ${state?.status ?? "unknown"} (epoch=${state?.epoch ?? 0}, pid=${state?.pid ?? "?"})`,
          );
          console.log(
            `  decision=${state?.lastDecision ?? "?"} apr=${pct(state?.currentApr ?? 0)} alive=${!!hb}`,
          );
        }
      }
      redis.close();
    } catch {
      // DragonflyDB not available — fall back to SQLite
    }

    if (!usedRedis) {
      // SQLite fallback
      for (const pair of pairs) {
        const db = initPairStore(pair.id);
        const positions = getPositions(db);
        console.log(`\n${pair.id}: ${positions.length} position(s)`);
        for (const p of positions) {
          console.log(
            `  ${p.pool.slice(0, 10)}... chain=${p.chain} ticks=[${p.tickLower},${p.tickUpper}] apr=${pct(p.entryApr)}`,
          );
        }
        db.close();
      }
    }
    await log.shutdown();
    return;
  }

  // ---- cycle: one-shot CLI mode (no orchestration) ----
  if (command === "cycle") {
    const pairs = loadPairConfigs();
    if (!pairs.length) {
      log.error("No pairs configured.");
      process.exitCode = 1;
      return;
    }

    for (const pair of pairs) {
      const db = initPairStore(pair.id);
      const pk = (process.env[pair.eoaEnvVar] as `0x${string}` | undefined) ?? null;
      registerPair(pair.id, db, pair);

      if (!pk) {
        log.warn(
          `No private key for ${pair.id} (set ${pair.eoaEnvVar}), running in read-only mode`,
        );
      }

      const decision = await runSingleCycle(db, pair, pk);
      console.log(`${pair.id}: ${decision.type}`, {
        currentApr: pct(decision.currentApr),
        optimalApr: pct(decision.optimalApr),
        improvement: pct(decision.improvement),
        allocations: decision.targetAllocations.length,
        rangeShifts: decision.rangeShifts?.length ?? 0,
      });
    }
    await log.shutdown();
    return;
  }

  log.error(`Unknown command: ${command}. Use --help for usage.`);
  process.exitCode = 1;
}

main().catch((e) => {
  log.error(`Fatal: ${errMsg(e)}`);
  process.exitCode = 1;
});
