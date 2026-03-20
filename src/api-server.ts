import { startApi } from "./api";
import { createRedis } from "./infra/redis";
import { DEFAULT_API_PORT } from "./config/params";
import { log } from "./utils";
import { initLogLevel } from "./infra/logger";

initLogLevel();

const port = parseInt(process.env.API_PORT || String(DEFAULT_API_PORT));
const redis = createRedis();
const server = startApi(port, redis);

async function shutdown() {
  server.stop();
  await log.shutdown();
  try {
    redis.close();
  } catch {}
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
