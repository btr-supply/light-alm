import { errMsg } from "../../shared/format";
import {
  O2_FLUSH_INTERVAL_MS,
  O2_BUFFER_SIZE,
  O2_FETCH_TIMEOUT_MS,
  O2_MAX_BUFFER_PER_STREAM,
} from "../config/params";

/** BigInt-safe JSON replacer. */
const bigintReplacer = (_: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

type ResponseCb = (status: number) => void;

/**
 * Persistent TCP socket sending HTTP/1.1 keep-alive to OpenObserve.
 * Requests are serialized (one in-flight at a time). Auto-reconnects on failure.
 */
class TcpTransport {
  private sock: import("bun").Socket | null = null;
  private host: string;
  private port: number;
  private connectP: Promise<boolean> | null = null;
  private resBuf = "";
  private onResponse: ResponseCb | null = null;
  private queue: { path: string; body: string; auth: string; resolve: (s: number) => void }[] = [];
  private draining = false;
  private pendingWrite: Buffer | null = null;
  private writeResolve: ((ok: boolean) => void) | null = null;

  constructor(url: string) {
    const u = new URL(url);
    this.host = u.hostname;
    this.port = parseInt(u.port) || 80;
  }

  private async ensureSocket(): Promise<boolean> {
    if (this.sock) return true;
    if (this.connectP) return this.connectP;
    const self = this;
    this.connectP = Bun.connect({
      hostname: this.host,
      port: this.port,
      socket: {
        data(_, chunk) { self.handleChunk(chunk); },
        drain() { self.onDrain(); },
        close() { self.onDisconnect(); },
        error(_, e) { console.error(`[O2 TCP] ${e.message}`); self.onDisconnect(); },
      },
    }).then(
      (s) => { self.sock = s; self.connectP = null; return true; },
      () => { self.connectP = null; return false; },
    );
    return this.connectP;
  }

  private onDisconnect() {
    this.sock = null;
    this.resBuf = "";
    this.pendingWrite = null;
    if (this.writeResolve) { this.writeResolve(false); this.writeResolve = null; }
    this.onResponse?.(0);
    this.onResponse = null;
  }

  private onDrain() {
    if (!this.pendingWrite || !this.sock) return;
    const written = this.sock.write(this.pendingWrite);
    if (written === this.pendingWrite.length) {
      this.pendingWrite = null;
      this.writeResolve?.(true);
      this.writeResolve = null;
    } else if (written > 0) {
      this.pendingWrite = this.pendingWrite.subarray(written);
    }
    // written === 0: wait for next drain
  }

  /** Write all bytes to socket, handling partial writes via drain events. */
  private writeAll(data: string): Promise<boolean> {
    if (!this.sock) return Promise.resolve(false);
    const buf = Buffer.from(data);
    const written = this.sock.write(buf);
    if (written === buf.length) return Promise.resolve(true);
    if (written > 0) {
      this.pendingWrite = buf.subarray(written);
    } else {
      this.pendingWrite = buf;
    }
    return new Promise<boolean>((resolve) => { this.writeResolve = resolve; });
  }

  private handleChunk(chunk: Buffer) {
    this.resBuf += chunk.toString();
    const hdrEnd = this.resBuf.indexOf("\r\n\r\n");
    if (hdrEnd === -1) return;

    // Status code from first line
    const firstLine = this.resBuf.substring(0, this.resBuf.indexOf("\r\n"));
    const m = firstLine.match(/HTTP\/\d\.\d\s+(\d+)/);
    const status = m ? parseInt(m[1]) : 0;

    // Consume response body based on framing
    const hdr = this.resBuf.substring(0, hdrEnd).toLowerCase();
    const bodyStart = hdrEnd + 4;
    const clm = hdr.match(/content-length:\s*(\d+)/);

    if (clm) {
      const cl = parseInt(clm[1]);
      if (this.resBuf.length < bodyStart + cl) return; // Partial body
      this.resBuf = this.resBuf.substring(bodyStart + cl);
    } else if (hdr.includes("transfer-encoding: chunked")) {
      const idx = this.resBuf.indexOf("0\r\n\r\n", bodyStart);
      if (idx === -1) return; // Wait for final chunk
      this.resBuf = this.resBuf.substring(idx + 5);
    } else {
      // No body framing (204 No Content, etc.)
      this.resBuf = this.resBuf.substring(bodyStart);
    }

    this.onResponse?.(status);
    this.onResponse = null;
  }

  /** Enqueue an HTTP POST. Resolves with status code (0 = failure/timeout). */
  post(path: string, body: string, auth: string): Promise<number> {
    return new Promise<number>((resolve) => {
      this.queue.push({ path, body, auth, resolve });
      this.drain();
    });
  }

  private async drain() {
    if (this.draining) return;
    this.draining = true;
    while (this.queue.length) {
      const req = this.queue.shift()!;
      req.resolve(await this.send(req.path, req.body, req.auth));
    }
    this.draining = false;
  }

  private async send(path: string, body: string, auth: string): Promise<number> {
    if (!(await this.ensureSocket()) || !this.sock) return 0;

    const raw =
      `POST ${path} HTTP/1.1\r\nHost: ${this.host}\r\n` +
      `Content-Type: application/json\r\nAuthorization: ${auth}\r\n` +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      `Connection: keep-alive\r\n\r\n${body}`;

    const written = await this.writeAll(raw);
    if (!written) { this.sock = null; return 0; }

    return new Promise<number>((resolve) => {
      const timer = setTimeout(() => {
        if (this.onResponse === cb) this.onResponse = null;
        resolve(0);
      }, O2_FETCH_TIMEOUT_MS);
      const cb: ResponseCb = (s) => { clearTimeout(timer); resolve(s); };
      this.onResponse = cb;
    });
  }

  close() {
    this.sock?.end();
    this.sock = null;
    this.pendingWrite = null;
    if (this.writeResolve) { this.writeResolve(false); this.writeResolve = null; }
    this.onResponse?.(0);
    this.onResponse = null;
    for (const req of this.queue) req.resolve(0);
    this.queue = [];
  }
}

/** OpenObserve ingestion client with buffered writes over persistent TCP. */
export class O2Client {
  private buffer: Record<string, unknown[]> = {};
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;
  private streamFlushP = new Map<string, Promise<void>>();
  private transport: TcpTransport;
  private org: string;
  private authHeader: string;

  constructor(url: string, org: string, token: string) {
    this.transport = new TcpTransport(url);
    this.org = org;
    this.authHeader = `Basic ${token}`;
    this.timer = setInterval(() => this.flush(), O2_FLUSH_INTERVAL_MS);
  }

  /** Queue entries for a given stream. Flushes automatically at buffer threshold or timer. */
  ingest(stream: string, entries: Record<string, unknown>[]) {
    if (!this.buffer[stream]) this.buffer[stream] = [];
    this.buffer[stream].push(...entries);
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

  /** Stop the background flush timer, drain remaining entries, close TCP socket. */
  async shutdown(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
    this.transport.close();
  }

  private async flushStream(stream: string): Promise<void> {
    // Await any in-progress flush for this stream, then flush remaining data
    const existing = this.streamFlushP.get(stream);
    if (existing) await existing;

    const entries = this.buffer[stream];
    if (!entries?.length) return;
    this.buffer[stream] = [];

    const p = this.sendStream(stream, entries).finally(() => {
      if (this.streamFlushP.get(stream) === p) this.streamFlushP.delete(stream);
    });
    this.streamFlushP.set(stream, p);
    await p;
  }

  private async sendStream(stream: string, entries: unknown[]): Promise<void> {
    try {
      const path = `/api/${this.org}/${stream}/_json`;
      const body = JSON.stringify(entries, bigintReplacer);
      const status = await this.transport.post(path, body, this.authHeader);
      if (status < 200 || status >= 300) {
        console.error(`O2 ingest ${stream}: HTTP ${status || "timeout/disconnect"}`);
        if (!this.buffer[stream]) this.buffer[stream] = [];
        this.buffer[stream].unshift(...entries);
      }
    } catch (e) {
      console.error(`O2 ingest ${stream}: ${errMsg(e)}`);
      if (!this.buffer[stream]) this.buffer[stream] = [];
      this.buffer[stream].unshift(...entries);
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
