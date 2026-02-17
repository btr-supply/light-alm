import { getO2Client } from "./o2";

export const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
export type Level = keyof typeof LEVELS;

let minLevel: Level = "info";
const logStdout = process.env.LOG_STDOUT !== "0";
const processName = process.env.WORKER_PAIR_ID || "orchestrator";

export interface LogFields {
  pairId?: string;
  epoch?: number;
  chain?: number;
  pool?: string;
  [key: string]: unknown;
}

function emit(level: Level, msg: string, fields?: LogFields, extra?: unknown[]) {
  if (LEVELS[level] < LEVELS[minLevel]) return;

  const ts = new Date().toISOString();
  const tsShort = ts.slice(11, 23);

  // Console output (backward-compatible format)
  if (logStdout) {
    const prefix = `[${tsShort}] ${level.toUpperCase().padEnd(5)}`;
    const consoleMethod = level === "debug" ? "log" : level;
    if (extra?.length) {
      console[consoleMethod](`${prefix} ${msg}`, ...extra);
    } else {
      console[consoleMethod](`${prefix} ${msg}`);
    }
  }

  // OpenObserve structured ingestion
  const o2 = getO2Client();
  if (o2) {
    o2.ingest("logs", [
      {
        _timestamp: ts,
        level,
        msg,
        process: processName,
        ...fields,
      },
    ]);
  }
}

export const structuredLog = {
  setLevel(l: Level) {
    minLevel = l;
  },
  debug(msg: string, fields?: LogFields, ...a: unknown[]) {
    emit("debug", msg, fields, a);
  },
  info(msg: string, fields?: LogFields, ...a: unknown[]) {
    emit("info", msg, fields, a);
  },
  warn(msg: string, fields?: LogFields, ...a: unknown[]) {
    emit("warn", msg, fields, a);
  },
  error(msg: string, fields?: LogFields, ...a: unknown[]) {
    emit("error", msg, fields, a);
  },
  async flush() {
    await getO2Client()?.flush();
  },
  async shutdown() {
    await getO2Client()?.shutdown();
  },
};
