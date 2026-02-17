# Logging & Monitoring

Dual-sink structured logging with console output and OpenObserve HTTP ingestion.

## Architecture

The observability stack consists of two components:

1. **Logger** (`src/infra/logger.ts`) -- structured log emitter with level filtering
2. **O2 Client** (`src/infra/o2.ts`) -- buffered HTTP client for OpenObserve ingestion

```
Application code
    |
    v
  Logger.emit(level, message, fields)
    |---> Console (real-time, human-readable)
    +---> O2 Client buffer
            |
            v (flush every 5s or 100 entries)
        OpenObserve HTTP API
```

## Logger

The logger provides structured log emission with consistent field formatting.

### API

```typescript
logger.emit(level: LogLevel, message: string, fields?: Record<string, unknown>)
```

### Log Levels

| Level | Usage |
|-------|-------|
| `debug` | Detailed internal state, disabled in production |
| `info` | Normal operations: cycle start, position minted, swap completed |
| `warn` | Degraded conditions: source timeout, stale data, fallback used |
| `error` | Failures: TX revert, simulation error, all sources failed |

### Console Output

Console logs are formatted for human readability with:
- Timestamp (ISO 8601)
- Level (color-coded in TTY)
- Worker/pair context prefix
- Message and flattened fields

### Field Conventions

Standard fields included in every log entry:
- `pairId` -- the pair context (set once per worker)
- `component` -- source module (executor, ohlc, gecko, etc.)
- `cycle` -- current cycle number
- `timestamp` -- Unix milliseconds

## O2 Client (OpenObserve)

The O2 client handles buffered HTTP ingestion to an OpenObserve instance.

### Buffering

| Parameter | Value | Source |
|-----------|-------|--------|
| Buffer size (flush threshold) | 100 entries | `O2_BUFFER_SIZE` |
| Flush interval | 5,000 ms | `O2_FLUSH_INTERVAL_MS` |
| Max buffer per stream | 10,000 entries | `O2_MAX_BUFFER_PER_STREAM` |
| HTTP timeout | 10,000 ms | `O2_FETCH_TIMEOUT_MS` |

When the buffer reaches 100 entries, it flushes immediately regardless of the timer. The 5-second timer ensures low-traffic periods still get timely ingestion. During prolonged O2 outages, the buffer is capped at 10,000 entries per stream to prevent OOM; oldest entries are dropped when exceeded.

### HTTP Transport

- **Method**: POST to `{O2_URL}/api/{O2_ORG}/{stream}/_json`
- **Content-Type**: `application/json`
- **Auth**: `Basic {O2_TOKEN}` (O2_TOKEN is a pre-encoded Base64 string)
- **BigInt safety**: BigInt values are serialized as strings via a custom JSON replacer
- **Retry**: failed flushes re-queue entries to the front of the buffer for the next cycle
- **Per-stream locking**: concurrent flushes to the same stream are prevented

### Streams

Data is routed to separate OpenObserve streams by type:

| Stream | Source | Description |
|--------|--------|-------------|
| `logs` | Logger | All structured log entries |
| `pool_snapshots` | GeckoTerminal | Pool TVL, volume, fees |
| `pool_analyses` | Analysis engine | Per-pool force/range analysis |
| `pair_allocations` | Strategy | Allocation decisions |
| `epoch_snapshots` | Cycle end | Per-cycle summary metrics |
| `tx_log` | Executor | Transaction records |
| `optimizer_state` | Nelder-Mead | Optimizer warm-start data |

Each stream maps to an OpenObserve index with automatic field detection. No schema pre-configuration is needed.

### Graceful Shutdown

On process exit, the O2 client stops the flush timer and drains any remaining buffered entries before the process terminates. This prevents data loss during graceful shutdowns.

## Configuration

| Env Var | Description | Default |
|---------|-------------|---------|
| `O2_URL` | OpenObserve base URL | *(disabled if unset)* |
| `O2_ORG` | OpenObserve organization | `default` |
| `O2_TOKEN` | Base64-encoded Basic auth credentials | *(disabled if unset)* |
| `LOG_LEVEL` | Minimum log level | `info` |

Both `O2_URL` and `O2_TOKEN` must be set to enable OpenObserve ingestion. If either is missing, the O2 sink is silently disabled and only console logging is active. The token is validated as Base64 on startup; a warning is logged if the format is invalid.

## Querying

OpenObserve provides a SQL-compatible query interface. Example queries:

```sql
-- Failed transactions in the last hour
SELECT * FROM tx_log WHERE status = 'reverted' AND _timestamp > NOW() - INTERVAL 1 HOUR

-- Average cycle APR per pair
SELECT pair_id, AVG(current_apr) FROM epoch_snapshots GROUP BY pair_id

-- Pool TVL trends
SELECT pool, ts, tvl FROM pool_snapshots WHERE pool = '0x...' ORDER BY ts
```

## See Also

- [Process Orchestration](./orchestrator.md) -- worker log routing
- [REST API](./api.md) -- API request logging
- [SQLite Schema](../data/store.md) -- local storage (complementary to O2)
- [Multi-Source OHLC](../data/ohlc.md) -- candle stream source
