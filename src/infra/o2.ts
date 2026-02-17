import { errMsg } from "../../shared/format";
import {
  O2_FLUSH_INTERVAL_MS,
  O2_BUFFER_SIZE,
  O2_FETCH_TIMEOUT_MS,
  O2_MAX_BUFFER_PER_STREAM,
} from "../config/params";

/** BigInt-safe JSON replacer. */
const bigintReplacer = (_: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

/** OpenObserve HTTP ingestion client with buffered writes. */
export class O2Client {
  private buffer: Record<string, unknown[]> = {};
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;
  private streamFlushing = new Set<string>();
  private url: string;
  private org: string;
  private authHeader: string;

  constructor(url: string, org: string, token: string) {
    this.url = url.replace(/\/$/, "");
    this.org = org;
    this.authHeader = `Basic ${token}`;
    this.timer = setInterval(() => this.flush(), O2_FLUSH_INTERVAL_MS);
  }

  /** Queue entries for a given stream. Flushes automatically at buffer threshold or timer. */
  ingest(stream: string, entries: Record<string, unknown>[]) {
    if (!this.buffer[stream]) this.buffer[stream] = [];
    this.buffer[stream].push(...entries);
    // Drop oldest entries to prevent OOM during prolonged O2 outages
    if (this.buffer[stream].length > O2_MAX_BUFFER_PER_STREAM) {
      this.buffer[stream] = this.buffer[stream].slice(-O2_MAX_BUFFER_PER_STREAM);
    }
    if (this.buffer[stream].length >= O2_BUFFER_SIZE) this.flushStream(stream);
  }

  /** Flush all buffered entries to OpenObserve. */
  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      const streams = Object.keys(this.buffer);
      await Promise.allSettled(streams.map((s) => this.flushStream(s)));
    } finally {
      this.flushing = false;
    }
  }

  /** Stop the background flush timer and drain remaining entries. */
  async shutdown(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
  }

  private async flushStream(stream: string): Promise<void> {
    if (this.streamFlushing.has(stream)) return;
    const entries = this.buffer[stream];
    if (!entries?.length) return;
    this.streamFlushing.add(stream);
    this.buffer[stream] = [];
    try {
      const res = await fetch(`${this.url}/api/${this.org}/${stream}/_json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: this.authHeader },
        body: JSON.stringify(entries, bigintReplacer),
        signal: AbortSignal.timeout(O2_FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        console.error(`O2 ingest ${stream}: ${res.status} ${res.statusText}`);
        if (!this.buffer[stream]) this.buffer[stream] = [];
        this.buffer[stream].unshift(...entries);
      }
    } catch (e) {
      console.error(`O2 ingest ${stream}: ${errMsg(e)}`);
      if (!this.buffer[stream]) this.buffer[stream] = [];
      this.buffer[stream].unshift(...entries);
    } finally {
      this.streamFlushing.delete(stream);
    }
  }
}

let _client: O2Client | null = null;

/** Get or create the singleton O2 client. Returns null if O2_URL is not configured. */
let _warnedUnconfigured = false;

export function getO2Client(): O2Client | null {
  if (_client) return _client;
  const url = process.env.O2_URL;
  const org = process.env.O2_ORG || "default";
  const token = process.env.O2_TOKEN;
  if (!url || !token) {
    if (!_warnedUnconfigured) {
      _warnedUnconfigured = true;
      console.warn(
        "[O2] OpenObserve not configured (set O2_URL + O2_TOKEN for persistent metrics)",
      );
    }
    return null;
  }
  if (!/^[A-Za-z0-9+/]+=*$/.test(token)) {
    console.warn("[O2] O2_TOKEN is not valid Base64 — Basic auth may fail");
  }
  _client = new O2Client(url, org, token);
  return _client;
}

/** Fire-and-forget ingestion to an O2 stream. Safe to call even if O2 is not configured. */
export function ingestToO2(stream: string, entries: Record<string, unknown>[]) {
  getO2Client()?.ingest(
    stream,
    entries.map((e) => ({ _timestamp: new Date().toISOString(), ...e })),
  );
}
