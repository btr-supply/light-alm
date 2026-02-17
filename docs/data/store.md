# SQLite Schema

Per-worker SQLite database for strategy state, candle data, and transaction history.

## Database Configuration

- **Path**: `.data/{pairId}.db` (one database per pair/worker)
- **Journal mode**: WAL (Write-Ahead Logging) for concurrent read/write
- **Synchronous**: NORMAL (balances durability and performance)
- **Data retention**: 90 days, automatic pruning

In orchestrated API mode, a **read-only cache** with 5-minute eviction is used to serve API requests without holding write locks on worker databases.

## Tables

### `m1_candles`

One-minute OHLC candle data from CEX sources.

| Column | Type | Description |
|--------|------|-------------|
| ts | INTEGER | Unix timestamp ms (**PRIMARY KEY**) |
| o | REAL | Open price |
| h | REAL | High price |
| l | REAL | Low price |
| c | REAL | Close price |
| v | REAL | Trade volume |

### `pool_snapshots`

GeckoTerminal pool data captured each cycle.

| Column | Type | Description |
|--------|------|-------------|
| pool | TEXT | Pool address |
| chain | INTEGER | Chain ID |
| ts | INTEGER | Snapshot time |
| volume_24h | REAL | 24-hour volume |
| tvl | REAL | Total value locked |
| fee_pct | REAL | Fee tier (decimal, e.g. 0.0005) |
| base_price_usd | REAL | Base token USD price |
| quote_price_usd | REAL | Quote token USD price |
| exchange_rate | REAL | Token exchange rate |
| price_change_h1 | REAL | 1h price change % |
| price_change_h24 | REAL | 24h price change % |

Primary key: `(pool, chain, ts)`.

### `pool_analysis`

Per-pool analysis results computed each strategy cycle.

| Column | Type | Description |
|--------|------|-------------|
| pool | TEXT | Pool address |
| chain | INTEGER | Chain ID |
| ts | INTEGER | Analysis time |
| interval_volume | REAL | Volume in the last interval |
| fee_pct | REAL | Fee tier |
| fees_generated | REAL | Fees generated in interval |
| tvl | REAL | Total value locked |
| utilization | REAL | Volume/TVL utilization ratio |
| apr | REAL | Annualized return |
| exchange_rate | REAL | Token exchange rate |
| base_price_usd | REAL | Base token USD price |
| vforce | REAL | Volatility force (0-100) |
| mforce | REAL | Momentum force (0-100) |
| tforce | REAL | Trend force (0-100) |
| range_min | REAL | Computed range lower bound |
| range_max | REAL | Computed range upper bound |
| range_breadth | REAL | Range width as fraction of price |
| range_bias | REAL | Directional bias (-1 to +1) |
| range_confidence | REAL | Confidence score (0-100) |

Primary key: `(pool, chain, ts)`.

### `pair_allocation`

Strategy allocation decisions per cycle.

| Column | Type | Description |
|--------|------|-------------|
| ts | INTEGER | Decision time (**PRIMARY KEY**) |
| current_apr | REAL | Current portfolio APR |
| optimal_apr | REAL | Optimal target APR |
| improvement | REAL | APR improvement (optimal - current) |
| decision | TEXT | Decision type: PRA, RS, or HOLD |
| target_allocations | TEXT | JSON array of `AllocationEntry` targets |
| current_allocations | TEXT | JSON array of current `AllocationEntry` |

### `positions`

Active LP positions across all pools.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | Internal position ID (**PRIMARY KEY**) |
| pool | TEXT | Pool address or bytes32 ID |
| chain | INTEGER | Chain ID |
| dex | TEXT | DEX identifier |
| position_id | TEXT | On-chain ID: tokenId (V3/V4) or `lb:lower:upper` (LB) |
| tick_lower | INTEGER | Lower tick/bin |
| tick_upper | INTEGER | Upper tick/bin |
| liquidity | TEXT | Liquidity amount (string for BigInt) |
| amount0 | TEXT | Token0 deposited (string for BigInt) |
| amount1 | TEXT | Token1 deposited (string for BigInt) |
| entry_price | REAL | Exchange rate at entry |
| entry_ts | INTEGER | Mint timestamp |
| entry_apr | REAL | Pool APR at entry |
| entry_value_usd | REAL | USD value at entry |

### `tx_log`

Full transaction history for auditing.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Auto-increment (**PRIMARY KEY**) |
| ts | INTEGER | Submission time |
| decision_type | TEXT | PRA, RS, or HOLD |
| op_type | TEXT | mint, burn, swap, approve, bridge |
| pool | TEXT | Pool address |
| chain | INTEGER | Chain ID |
| tx_hash | TEXT | Transaction hash |
| status | TEXT | success or reverted |
| gas_used | TEXT | Actual gas consumed (string for BigInt) |
| gas_price | TEXT | Effective gas price (string for BigInt) |
| input_token | TEXT | Input token symbol |
| input_amount | TEXT | Input amount |
| input_usd | REAL | Input USD value |
| output_token | TEXT | Output token symbol |
| output_amount | TEXT | Output amount |
| output_usd | REAL | Output USD value |
| target_allocation_pct | REAL | Target allocation % |
| actual_allocation_pct | REAL | Actual allocation % |
| allocation_error_pct | REAL | Allocation tracking error % |

### `optimizer_state`

Nelder-Mead optimizer warm-start state for strategy parameter tuning.

| Column | Type | Description |
|--------|------|-------------|
| pair_id | TEXT | Pair identifier (**PRIMARY KEY**) |
| vec | TEXT | JSON-serialized parameter vector (5 floats) |
| fitness | REAL | Best fitness value |
| updated_at | INTEGER | Last update timestamp |

### `epoch_snapshots`

Per-cycle summary metrics for performance tracking.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Auto-increment (**PRIMARY KEY**) |
| pair_id | TEXT | Pair identifier (NOT NULL) |
| epoch | INTEGER | Cycle number (NOT NULL) |
| ts | INTEGER | Cycle timestamp (NOT NULL) |
| decision | TEXT | PRA, RS, or HOLD (NOT NULL) |
| portfolio_value_usd | REAL | Portfolio value (default 0) |
| fees_earned_usd | REAL | Fees earned this epoch (default 0) |
| gas_spent_usd | REAL | Gas cost this epoch (default 0) |
| il_usd | REAL | Impermanent loss this epoch (default 0) |
| net_pnl_usd | REAL | Net PnL this epoch (default 0) |
| range_efficiency | REAL | Time-in-range fraction (default 0) |
| current_apr | REAL | Current APR (default 0) |
| optimal_apr | REAL | Optimal APR (default 0) |
| positions_count | INTEGER | Active position count (default 0) |

Unique constraint: `(pair_id, epoch)`.

## Maintenance

Automatic pruning runs on worker startup via `pruneOldData()`, deleting rows older than 90 days from all time-series tables. The `optimizer_state` table is exempt (retained indefinitely for warm-start continuity).

```sql
DELETE FROM m1_candles WHERE ts < ?;    -- cutoff = now - 90 days
DELETE FROM pool_snapshots WHERE ts < ?;
DELETE FROM pool_analysis WHERE ts < ?;
DELETE FROM pair_allocation WHERE ts < ?;
DELETE FROM tx_log WHERE ts < ?;
DELETE FROM epoch_snapshots WHERE ts < ?;
```

## See Also

- [Multi-Source OHLC](./ohlc.md) -- candle ingestion pipeline
- [GeckoTerminal Integration](./gecko.md) -- pool snapshot source
- [Range Optimizer](../strategy/optimizer.md) -- optimizer_state table used for warm-start
- [REST API](../infrastructure/api.md) -- read-only cache for API serving
- [Process Orchestration](../infrastructure/orchestrator.md) -- per-worker DB isolation
