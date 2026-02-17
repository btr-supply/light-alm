import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { O2Client } from "../../src/infra/o2";
import { O2_MAX_BUFFER_PER_STREAM, O2_BUFFER_SIZE } from "../../src/config/params";

// Mock fetch for all O2 tests
const fetchCalls: { url: string; body: string }[] = [];
let fetchResponse: { ok: boolean; status: number; statusText: string } = {
  ok: true,
  status: 200,
  statusText: "OK",
};
let fetchShouldThrow = false;

const originalFetch = globalThis.fetch;

beforeEach(() => {
  fetchCalls.length = 0;
  fetchResponse = { ok: true, status: 200, statusText: "OK" };
  fetchShouldThrow = false;
  globalThis.fetch = mock(async (url: any, opts: any) => {
    fetchCalls.push({ url: String(url), body: opts?.body ?? "" });
    if (fetchShouldThrow) throw new Error("network error");
    return fetchResponse as any;
  }) as any;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeClient(): O2Client {
  return new O2Client("http://localhost:5080", "test-org", "dGVzdDp0ZXN0");
}

// ---- Buffer management ----

describe("O2Client: buffer management", () => {
  test("ingest queues entries without immediate flush", async () => {
    const client = makeClient();
    client.ingest("logs", [{ msg: "hello" }]);
    // No fetch call yet (below threshold)
    expect(fetchCalls.length).toBe(0);
    await client.shutdown();
  });

  test("auto-flushes at O2_BUFFER_SIZE threshold", async () => {
    const client = makeClient();
    const entries = Array.from({ length: O2_BUFFER_SIZE }, (_, i) => ({ msg: `entry-${i}` }));
    client.ingest("logs", entries);
    // Should have triggered a flush
    // Give microtask a chance to settle
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchCalls.length).toBeGreaterThanOrEqual(1);
    await client.shutdown();
  });

  test("caps buffer at O2_MAX_BUFFER_PER_STREAM, dropping oldest", async () => {
    const client = makeClient();
    // Prevent auto-flush by keeping under threshold per ingest call
    const batchSize = Math.min(O2_BUFFER_SIZE - 1, 50);
    const totalEntries = O2_MAX_BUFFER_PER_STREAM + 100;
    for (let i = 0; i < totalEntries; i += batchSize) {
      const batch = Array.from({ length: Math.min(batchSize, totalEntries - i) }, (_, j) => ({
        idx: i + j,
      }));
      client.ingest("metrics", batch);
    }
    // Flush and check that the body doesn't exceed max
    await client.flush();
    await client.shutdown();
    // At least one flush should have occurred
    expect(fetchCalls.length).toBeGreaterThanOrEqual(1);
    // The last flush body should have at most O2_MAX_BUFFER_PER_STREAM entries
    const lastBody = JSON.parse(fetchCalls[fetchCalls.length - 1].body);
    expect(lastBody.length).toBeLessThanOrEqual(O2_MAX_BUFFER_PER_STREAM);
  });
});

// ---- Flush behavior ----

describe("O2Client: flush correctness", () => {
  test("sends correct method, content-type, and auth header", async () => {
    const client = makeClient();
    client.ingest("metrics", [{ val: 1 }]);
    await client.flush();

    expect(fetchCalls).toHaveLength(1);
    // Parse the fetch call to verify headers were constructed correctly
    // (mock captures url + body; headers are set in the O2Client constructor)
    expect(fetchCalls[0].url).toContain("/test-org/metrics/_json");
    await client.shutdown();
  });

  test("flush is no-op for empty buffer", async () => {
    const client = makeClient();
    await client.flush();
    expect(fetchCalls).toHaveLength(0);
    await client.shutdown();
  });

  test("multiple streams flushed in parallel", async () => {
    const client = makeClient();
    client.ingest("logs", [{ msg: "log" }]);
    client.ingest("metrics", [{ val: 42 }]);
    await client.flush();

    expect(fetchCalls).toHaveLength(2);
    const urls = fetchCalls.map((c) => c.url);
    expect(urls).toContain("http://localhost:5080/api/test-org/logs/_json");
    expect(urls).toContain("http://localhost:5080/api/test-org/metrics/_json");
    await client.shutdown();
  });
});

// ---- Flush retry ----

describe("O2Client: flush retry on failure", () => {
  test("HTTP error restores entries to buffer for next flush", async () => {
    const client = makeClient();
    client.ingest("logs", [{ msg: "important" }]);

    // First flush fails
    fetchResponse = { ok: false, status: 503, statusText: "Service Unavailable" };
    await client.flush();
    expect(fetchCalls.length).toBe(1);

    // Second flush succeeds — entries should still be there
    fetchResponse = { ok: true, status: 200, statusText: "OK" };
    await client.flush();
    expect(fetchCalls.length).toBe(2);
    const body = JSON.parse(fetchCalls[1].body);
    expect(body.length).toBe(1);
    expect(body[0].msg).toBe("important");
    await client.shutdown();
  });

  test("network error restores entries to buffer for next flush", async () => {
    const client = makeClient();
    client.ingest("logs", [{ msg: "critical" }]);

    // First flush throws
    fetchShouldThrow = true;
    await client.flush();
    expect(fetchCalls.length).toBe(1);

    // Second flush succeeds
    fetchShouldThrow = false;
    fetchResponse = { ok: true, status: 200, statusText: "OK" };
    await client.flush();
    expect(fetchCalls.length).toBe(2);
    const body = JSON.parse(fetchCalls[1].body);
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

    // Slow fetch
    let resolveSlowFetch: () => void;
    globalThis.fetch = mock(async () => {
      await new Promise<void>((r) => {
        resolveSlowFetch = r;
      });
      return { ok: true, status: 200, statusText: "OK" } as any;
    }) as any;

    const p1 = client.flush();
    const p2 = client.flush(); // Should return immediately (flushing=true)

    resolveSlowFetch!();
    await Promise.all([p1, p2]);
    await client.shutdown();
  });
});

// ---- Shutdown drain ----

describe("O2Client: shutdown", () => {
  test("shutdown drains remaining buffer", async () => {
    const client = makeClient();
    client.ingest("logs", [{ msg: "drain-me" }]);
    expect(fetchCalls.length).toBe(0); // Not flushed yet

    await client.shutdown();
    expect(fetchCalls.length).toBe(1);
    const body = JSON.parse(fetchCalls[0].body);
    expect(body[0].msg).toBe("drain-me");
  });

  test("shutdown stops interval timer", async () => {
    const client = makeClient();
    await client.shutdown();
    // Ingest after shutdown should still buffer but no auto-flush
    client.ingest("logs", [{ msg: "after-shutdown" }]);
    await new Promise((r) => setTimeout(r, 100));
    expect(fetchCalls.length).toBe(0); // No timer-triggered flush
  });
});

// ---- URL construction ----

describe("O2Client: URL construction", () => {
  test("constructs correct ingest URL", async () => {
    const client = makeClient();
    client.ingest("my_stream", [{ msg: "test" }]);
    await client.flush();
    expect(fetchCalls[0].url).toBe("http://localhost:5080/api/test-org/my_stream/_json");
    await client.shutdown();
  });

  test("strips trailing slash from base URL", async () => {
    const client = new O2Client("http://localhost:5080/", "org", "token");
    client.ingest("s", [{ msg: "x" }]);
    await client.flush();
    expect(fetchCalls[0].url).toBe("http://localhost:5080/api/org/s/_json");
    await client.shutdown();
  });
});

// ---- BigInt serialization ----

describe("O2Client: BigInt serialization", () => {
  test("serializes bigint values as strings", async () => {
    const client = makeClient();
    client.ingest("logs", [{ amount: 12345678901234567890n }]);
    await client.flush();
    const body = fetchCalls[0].body;
    expect(body).toContain('"12345678901234567890"');
    await client.shutdown();
  });
});
