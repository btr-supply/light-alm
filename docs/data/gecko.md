# GeckoTerminal Integration

On-chain pool metrics fetched from the GeckoTerminal API for pool scoring and allocation decisions.

## API

Base URL: `https://api.geckoterminal.com/api/v2`

Primary endpoint:
```
GET /networks/{network}/pools/{pool_address}
```

The `{network}` parameter maps to GeckoTerminal's chain slugs (configured in `chains.ts`):

| Chain | Slug |
|-------|------|
| Ethereum | `eth` |
| BSC | `bsc` |
| Polygon | `polygon_pos` |
| Base | `base` |
| Arbitrum | `arbitrum` |
| Avalanche | `avax` |
| HyperEVM | `hyperevm` |

## Rate Limiting

GeckoTerminal's public API enforces strict rate limits. The client enforces a minimum **2-second delay** between requests. For 41 pools, a full snapshot cycle takes approximately 82 seconds.

Requests are serialized (no concurrent calls to GeckoTerminal) to avoid 429 responses. If a 429 is received, the client backs off for 10 seconds before retrying.

## Response Data

Each pool response provides:

| Field | Description | Usage |
|-------|-------------|-------|
| `volume_usd.h24` | 24-hour trading volume in USD | Volume scoring |
| `reserve_in_usd` | Total value locked | TVL scoring |
| `pool_fee` | Fee tier (e.g., 0.003 for 30bps) | Fee efficiency calculation |
| `base_token_price_usd` | Current token0 price | Exchange rate |
| `price_change_percentage.h24` | 24h price change % | Volatility signal |

## Interval Volume Calculation

GeckoTerminal returns **cumulative 24h volume**, not per-interval volume. To compute volume for a single strategy cycle (15 minutes), the system uses **snapshot differencing**:

```
interval_volume = current_snapshot.volume_24h - previous_snapshot.volume_24h
```

This gives the actual volume that occurred between two consecutive snapshots.

### Fallback: Negative Diff

When the 24h window rolls over, the diff can be negative (e.g., a large trade 24h ago drops out of the window). In this case, the fallback estimate is used:

```
interval_volume = current_snapshot.volume_24h / 96
```

96 = number of 15-minute intervals in 24 hours. This provides a reasonable average when the differential method produces invalid results.

## Snapshot Storage

Each API response is ingested to the `pool_snapshots` OpenObserve stream with the current timestamp. The previous snapshot is queried from O2 for interval volume differencing.

The snapshot flow per cycle:

1. Read previous snapshot from OpenObserve
2. Fetch current data from GeckoTerminal API
3. Compute interval volume via diff (or fallback)
4. Ingest current snapshot to OpenObserve
5. Return computed metrics to the pool analysis stage

## Error Handling

| Scenario | Handling |
|----------|----------|
| 429 Too Many Requests | Backoff 10s, retry once |
| 404 Pool Not Found | Skip pool, log warning |
| Network timeout (30s) | Skip pool for this cycle |
| Invalid JSON response | Skip pool, log error |
| All pools failed | Cycle continues with stale data |

Partial failures are tolerated. If some pools return data and others fail, the strategy proceeds with available data. Pool scores for failed pools use the previous cycle's values.

## Data Flow

```
GeckoTerminal API
    │
    ▼
pool_snapshots (OpenObserve)
    │
    ├─► Pool analysis (scoring)
    └─► Allocation decisions
```

## See Also

- [Water-Fill Allocation](../strategy/allocation.md) -- consumes pool APR and TVL for capital distribution
- [Observability](../infrastructure/observability.md) -- pool_snapshots and pool_analyses O2 streams
- [Multi-Source OHLC](./ohlc.md) -- CEX candle data (complementary on-chain data)
- [Pool Registry](../config/pools.md) -- pool addresses used for API calls
- [Chain Configuration](../config/chains.md) -- GeckoTerminal network slugs
