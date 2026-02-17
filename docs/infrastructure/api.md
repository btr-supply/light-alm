# REST API

HTTP API for querying system state, pair data, and orchestrator management.

## Server Configuration

- **Port**: 3001 (configurable via `API_PORT` env var)
- **CORS**: enabled for all origins (`*`), methods GET/POST/OPTIONS
- **Runtime**: Bun's built-in HTTP server (`Bun.serve`)
- **BigInt serialization**: all BigInt values in JSON responses are converted to strings

## Dual Mode

The API runs in one of two modes depending on whether an orchestrator is present:

The API reads worker state from **DragonflyDB** and historical data from **OpenObserve**.

- Worker state: fetched from `btr:worker:{pairId}:state` in DragonflyDB
- Historical data: queried from OpenObserve via SQL search API
- Positions: read from DragonflyDB HASH (`btr:pair:{pairId}:positions`)

## Endpoints

### Health

```
GET /api/health
```

Response:
```json
{"ok": true, "uptime": 3600, "pairs": ["USDC-USDT"]}
```

### Pair List

```
GET /api/pairs
```

Returns all configured pairs with summary: id, position count, decision, APRs, epoch.

### Pair Status

```
GET /api/pairs/:id/status
```

Full pair status including epoch, decision, forces, optimizer params/fitness, regime, and kill-switch state.

### Positions

```
GET /api/pairs/:id/positions
```

Active LP positions for the pair. Includes pool, chain, dex, tick range, liquidity, amounts, and entry data.

### Allocations

```
GET /api/pairs/:id/allocations
```

Returns the latest allocation decision. With `?limit=N`, returns the N most recent allocations.

### Epoch Snapshots

```
GET /api/pairs/:id/snapshots
```

Epoch performance snapshots. Supports `?from=<ts>&to=<ts>&limit=N` query parameters.

### Pool Analyses

```
GET /api/pairs/:id/analyses
```

Latest pool analysis for all pools. With `?pool=<addr>&chain=<id>`, returns time-series for a specific pool. Supports `?from=<ts>&to=<ts>`.

### Candles

```
GET /api/pairs/:id/candles
```

M1 candle data. Supports `?from=<ts>&to=<ts>` (defaults to last 24 hours).

### Transaction Log

```
GET /api/pairs/:id/txlog
```

Transaction history ordered by most recent. Supports `?limit=N` (default 50).

### Orchestrator Status

```
GET /api/orchestrator/status
```

Orchestrated mode only. Returns worker count, uptime, and per-worker status (alive, last heartbeat, worker state).

### Worker Restart

```
POST /api/orchestrator/workers/:id/restart
```

Orchestrated mode only. Force-restart a specific worker via pub/sub command. **Requires authentication**: `Authorization: Bearer <token>` header. The token is configured via `API_TOKEN` env var. Returns 401 if missing or invalid.

## Response Format

All responses are **raw JSON** -- there is no `{ "data": ..., "timestamp": ... }` wrapper. Each endpoint returns its data directly:

```json
[
  {"id": "USDC-USDT", "positions": 3, "decision": "HOLD", "currentApr": 0.042}
]
```

Error responses:
```json
{"error": "Pair not found"}
```

CORS headers are included on every response:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
```

## BigInt Handling

Blockchain values (liquidity, token amounts, gas) are stored as BigInt internally. The API serializer converts these to strings in JSON responses:

```json
{
  "liquidity": "1234567890123456789",
  "amount0": "500000000000000000"
}
```

Consumers should parse these as BigInt or appropriate arbitrary-precision types.

## See Also

- [Process Orchestration](./orchestrator.md) -- worker state and DragonflyDB keys
- [Observability](./observability.md) -- O2 streams queried by the API
- [Observability](./observability.md) -- API request logging
