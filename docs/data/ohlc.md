# Multi-Source OHLC Candles

Aggregated M1 candle data from multiple CEX sources via ccxt REST, used for strategy decision-making.

## Architecture

Candle data is fetched from centralized exchanges using **ccxt REST** (not WebSockets). Since the system operates on 15-minute strategy cycles, real-time streaming is unnecessary. Candles are fetched every 15 minutes and stored in SQLite.

## Source Configuration

Each pair defines a weighted set of CEX sources. Weights determine how sources contribute to the aggregated price when multiple sources are available.

Example configuration for USDC-USDT:

| Source | Weight |
|--------|--------|
| Binance | 40% |
| Bybit | 25% |
| OKX | 20% |
| MEXC | 15% |

Weights are used for weighted-average price computation when aggregating across sources. If a source fails to return data, its weight is redistributed proportionally among available sources.

## Fetch Parameters

- **Candle interval**: M1 (1-minute)
- **Fetch limit**: 500 candles per request
- **Max iterations**: 100 (prevents runaway backfill loops)
- **Freshness lookback**: 20 candles -- the system checks the latest 20 M1 candles to determine if data is fresh enough to skip fetching

## Historical Backfill

On startup, the worker performs a **30-day backfill** for each configured source:

1. Query SQLite for the latest stored candle timestamp
2. If the gap exceeds 30 days, start from 30 days ago
3. Fetch in batches of 500 candles, paginating by timestamp
4. Insert with `ON CONFLICT REPLACE` to handle overlapping data
5. Continue until the current time is reached

Backfill runs sequentially per source to respect exchange rate limits.

## Gap Filling

After fetching, the system scans for gaps in the M1 candle series. A gap is any missing minute where adjacent candles exist. Gaps are filled using **linear interpolation** of OHLC values from the surrounding candles. This ensures downstream aggregation produces consistent results without missing periods.

## Aggregation

Raw M1 candles are aggregated into higher timeframes via `aggregateCandles()`:

| Timeframe | Candles per period | Use case |
|-----------|-------------------|----------|
| **M15** | 15 M1 candles | Strategy cycle alignment, chart display |
| **H1** | 60 M1 candles | Trend detection |
| **H4** | 240 M1 candles | Regime classification |

Aggregation rules:
- **Open**: first candle's open
- **High**: max of all highs
- **Low**: min of all lows
- **Close**: last candle's close
- **Volume**: sum of all volumes

Partial periods (incomplete candle count) are still aggregated but flagged.

## Storage

M1 candles are stored in the `m1_candles` table:

```sql
(ts INTEGER PRIMARY KEY, o REAL, h REAL, l REAL, c REAL, v REAL)
```

Primary key is `ts` (Unix timestamp ms). Duplicate inserts update the existing row via `ON CONFLICT REPLACE`.

Data retention is **90 days** -- candles older than 90 days are pruned automatically on worker startup.

## Error Handling

- Exchange timeout: 30s per request, skip source for this cycle
- Rate limiting: ccxt handles 429 responses with built-in retry
- Empty response: logged as warning, source skipped
- All sources failed: cycle continues with stale data, alert emitted

## See Also

- [3-Force Model](../strategy/forces.md) -- consumes aggregated candle data for force computation
- [SQLite Schema](./store.md) -- m1_candles table definition
- [GeckoTerminal Integration](./gecko.md) -- on-chain pool data (complementary to CEX candles)
- [Dashboard Price Chart](../dashboard/components.md) -- M15 aggregation for display
- [Observability](../infrastructure/observability.md) -- candle data streamed to OpenObserve
