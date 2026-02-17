import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { O2Client } from "../../src/infra/o2";
import { O2_MAX_BUFFER_PER_STREAM, O2_BUFFER_SIZE } from "../../src/config/params";

// ---- Mock TCP server (captures HTTP requests sent over persistent socket) ----

interface CapturedRequest {
  path: string;
  body: string;
  headers: string;
}

let server: ReturnType<typeof Bun.listen>;
let serverPort: number;
const received: CapturedRequest[] = [];
let responseStatus = 200;
let responseDelay = 0;
let shouldDisconnect = false;

// Per-socket buffer for partial HTTP request reassembly
const socketBuf = new Map<object, string>();

function respond(socket: { write: (d: string) => number; end: () => void }) {
  if (shouldDisconnect) {
    socket.end();
    return;
  }
  const res = `HTTP/1.1 ${responseStatus} OK\r\nContent-Length: 0\r\nConnection: keep-alive\r\n\r\n`;
  if (responseDelay > 0) {
    setTimeout(() => socket.write(res), responseDelay);
  } else {
    socket.write(res);
  }
}

beforeEach(() => {
  received.length = 0;
  socketBuf.clear();
  responseStatus = 200;
  responseDelay = 0;
  shouldDisconnect = false;

  server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      data(socket, data) {
        let buf = (socketBuf.get(socket) || "") + data.toString();

        // Process all complete HTTP requests in the buffer
        while (true) {
          const hdrEnd = buf.indexOf("\r\n\r\n");
          if (hdrEnd === -1) break;

          const headerStr = buf.substring(0, hdrEnd);
          const clMatch = headerStr.match(/Content-Length:\s*(\d+)/i);
          const cl = clMatch ? parseInt(clMatch[1]) : 0;
          const bodyStart = hdrEnd + 4;
          if (buf.length < bodyStart + cl) break; // Body incomplete

          const lineEnd = headerStr.indexOf("\r\n");
          const firstLine = headerStr.substring(0, lineEnd);
          const path = firstLine.split(" ")[1] || "";
          const headers = headerStr.substring(lineEnd + 2);
          const body = buf.substring(bodyStart, bodyStart + cl);
          received.push({ path, body, headers });
          buf = buf.substring(bodyStart + cl);
          respond(socket);
        }

        socketBuf.set(socket, buf);
      },
      open() {},
      close(socket) {
        socketBuf.delete(socket);
      },
      error() {},
    },
  });
  serverPort = server.port;
});

afterEach(() => {
  server.stop(true);
});

function makeClient(): O2Client {
  return new O2Client(`http://127.0.0.1:${serverPort}`, "test-org", "dGVzdDp0ZXN0");
}

const settle = (ms = 100) => new Promise((r) => setTimeout(r, ms));

// ---- Buffer management ----

describe("O2Client: buffer management", () => {
  test("ingest queues entries without immediate flush", async () => {
    const client = makeClient();
    client.ingest("logs", [{ msg: "hello" }]);
    await settle();
    expect(received.length).toBe(0);
    await client.shutdown();
  });

  test("auto-flushes at O2_BUFFER_SIZE threshold", async () => {
    const client = makeClient();
    const entries = Array.from({ length: O2_BUFFER_SIZE }, (_, i) => ({ msg: `entry-${i}` }));
    client.ingest("logs", entries);
    await settle();
    expect(received.length).toBeGreaterThanOrEqual(1);
    await client.shutdown();
  });

  test("caps buffer at O2_MAX_BUFFER_PER_STREAM, dropping oldest", async () => {
    const client = makeClient();
    const batchSize = Math.min(O2_BUFFER_SIZE - 1, 50);
    const totalEntries = O2_MAX_BUFFER_PER_STREAM + 100;
    for (let i = 0; i < totalEntries; i += batchSize) {
      const batch = Array.from({ length: Math.min(batchSize, totalEntries - i) }, (_, j) => ({
        idx: i + j,
      }));
      client.ingest("metrics", batch);
    }
    await client.flush();
    await client.shutdown();
    expect(received.length).toBeGreaterThanOrEqual(1);
    const lastBody = JSON.parse(received[received.length - 1].body);
    expect(lastBody.length).toBeLessThanOrEqual(O2_MAX_BUFFER_PER_STREAM);
  });
});

// ---- Flush behavior ----

describe("O2Client: flush correctness", () => {
  test("sends correct path and auth header", async () => {
    const client = makeClient();
    client.ingest("metrics", [{ val: 1 }]);
    await client.flush();

    expect(received).toHaveLength(1);
    expect(received[0].path).toBe("/api/test-org/metrics/_json");
    expect(received[0].headers).toContain("Basic dGVzdDp0ZXN0");
    await client.shutdown();
  });

  test("flush is no-op for empty buffer", async () => {
    const client = makeClient();
    await client.flush();
    expect(received).toHaveLength(0);
    await client.shutdown();
  });

  test("multiple streams flushed over same connection", async () => {
    const client = makeClient();
    client.ingest("logs", [{ msg: "log" }]);
    client.ingest("metrics", [{ val: 42 }]);
    await client.flush();

    expect(received).toHaveLength(2);
    const paths = received.map((r) => r.path);
    expect(paths).toContain("/api/test-org/logs/_json");
    expect(paths).toContain("/api/test-org/metrics/_json");
    await client.shutdown();
  });

  test("reuses persistent TCP connection across flushes", async () => {
    const client = makeClient();
    client.ingest("logs", [{ msg: "first" }]);
    await client.flush();
    client.ingest("logs", [{ msg: "second" }]);
    await client.flush();

    expect(received).toHaveLength(2);
    expect(JSON.parse(received[0].body)[0].msg).toBe("first");
    expect(JSON.parse(received[1].body)[0].msg).toBe("second");
    await client.shutdown();
  });
});

// ---- Flush retry ----

describe("O2Client: flush retry on failure", () => {
  test("HTTP error restores entries to buffer for next flush", async () => {
    const client = makeClient();
    client.ingest("logs", [{ msg: "important" }]);

    responseStatus = 503;
    await client.flush();
    expect(received.length).toBe(1);

    responseStatus = 200;
    await client.flush();
    expect(received.length).toBe(2);
    const body = JSON.parse(received[1].body);
    expect(body.length).toBe(1);
    expect(body[0].msg).toBe("important");
    await client.shutdown();
  });

  test("network disconnect restores entries to buffer for next flush", async () => {
    const client = makeClient();
    client.ingest("logs", [{ msg: "critical" }]);

    shouldDisconnect = true;
    await client.flush();
    expect(received.length).toBe(1);

    shouldDisconnect = false;
    responseStatus = 200;
    await client.flush();
    expect(received.length).toBe(2);
    const body = JSON.parse(received[1].body);
    expect(body.length).toBe(1);
    expect(body[0].msg).toBe("critical");
    await client.shutdown();
  });
});

// ---- Concurrent flush guard ----

describe("O2Client: concurrent flush guard", () => {
  test("flush is not re-entrant", async () => {
    const client = makeClient();
    client.ingest("logs", [{ msg: "a" }]);
    responseDelay = 100;

    const p1 = client.flush();
    const p2 = client.flush(); // Should return immediately (flushing=true)

    await Promise.all([p1, p2]);
    expect(received).toHaveLength(1);
    await client.shutdown();
  });
});

// ---- Shutdown drain ----

describe("O2Client: shutdown", () => {
  test("shutdown drains remaining buffer", async () => {
    const client = makeClient();
    client.ingest("logs", [{ msg: "drain-me" }]);
    expect(received.length).toBe(0);

    await client.shutdown();
    expect(received.length).toBe(1);
    const body = JSON.parse(received[0].body);
    expect(body[0].msg).toBe("drain-me");
  });

  test("shutdown stops interval timer", async () => {
    const client = makeClient();
    await client.shutdown();
    client.ingest("logs", [{ msg: "after-shutdown" }]);
    await settle(100);
    expect(received.length).toBe(0);
  });
});

// ---- Path construction ----

describe("O2Client: path construction", () => {
  test("constructs correct ingest path", async () => {
    const client = makeClient();
    client.ingest("my_stream", [{ msg: "test" }]);
    await client.flush();
    expect(received[0].path).toBe("/api/test-org/my_stream/_json");
    await client.shutdown();
  });

  test("trailing slash in URL does not affect path", async () => {
    const client = new O2Client(`http://127.0.0.1:${serverPort}/`, "org", "token");
    client.ingest("s", [{ msg: "x" }]);
    await client.flush();
    expect(received[0].path).toBe("/api/org/s/_json");
    await client.shutdown();
  });
});

// ---- BigInt serialization ----

describe("O2Client: BigInt serialization", () => {
  test("serializes bigint values as strings", async () => {
    const client = makeClient();
    client.ingest("logs", [{ amount: 12345678901234567890n }]);
    await client.flush();
    expect(received[0].body).toContain('"12345678901234567890"');
    await client.shutdown();
  });
});
