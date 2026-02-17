# Dashboard Specification

## Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Bundler | Vite 6 | Fast HMR, native Svelte support |
| Framework | Svelte 5 | Minimal runtime, fine-grained reactivity |
| UI | shadcn-svelte + Tailwind 4 | Composable components, dark-mode-first |
| Charts | lightweight-charts v5 | TradingView lib, candlestick + markers, ~40KB gzip |
| Data | Polling (30s) | Matches 15min cycle, no WebSocket complexity |

## API Layer (Bun.serve)

All endpoints return JSON. CORS enabled for dashboard origin.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | `{ ok, uptime, pairs }` |
| GET | `/api/pairs` | List all pairs with latest status summary |
| GET | `/api/pairs/:id/status` | Forces, decision, optimizer state, regime |
| GET | `/api/pairs/:id/positions` | Active positions |
| GET | `/api/pairs/:id/allocations` | Allocation history (latest N) |
| GET | `/api/pairs/:id/analyses` | Pool analysis time-series |
| GET | `/api/pairs/:id/candles` | M1 OHLC candles (`?from=&to=`) |
| GET | `/api/pairs/:id/txlog` | Transaction log (`?limit=50`) |

## Layout

3-column responsive layout (collapses to single column on mobile).

```
+------------------+------------------------------+------------------+
|  Pair List       |  Strategy Detail             |  Advanced Stats  |
|  (240px fixed)   |  (flex)                      |  (320px fixed)   |
|                  |                              |                  |
|  [USDC-USDT] *   |  Price + Range Chart         |  Optimizer       |
|  [WETH-USDC]    |  (lightweight-charts candle)  |   baseMin/Max    |
|  [WBTC-USDC]    |  Range overlay as markers     |   rsThreshold    |
|                  |                              |   fitness/evals  |
|                  |  Allocation Bars             |                  |
|                  |  (horizontal stacked bar)    |  Kill Switches   |
|                  |  pool → % allocation         |   trailing yield |
|                  |                              |   RS count/4h    |
|                  |  Forces                      |   gas budget     |
|                  |  V [====------] 42           |                  |
|                  |  M [=====-----] 55           |  Tx Log          |
|                  |  T [===-------] 31           |  (recent 20 txs) |
|                  |                              |                  |
|                  |  Decision Badge: HOLD/RS/PRA |  PnL Summary     |
|                  |  APR: current vs optimal     |   (from tx_log)  |
+------------------+------------------------------+------------------+
```

### Left Panel — Pair List (Strategies)

- List of all running and available pairs
- Status indicator: green=HOLD, yellow=RS, red=PRA, gray=offline
- Current APR, Range, and position (pool) count for the pair
- Click to select (updates center + right panels)

### Center Panel — Strategy Detail

**Price Chart** (top, ~400px height):
- Candlestick chart (M5 aggregated from M1 for readability)
- Range overlay: green band for current position range [tickLower, tickUpper] converted to price
- RS/PRA markers as vertical lines with labels
- Time range selector: 1H / 6H / 24H / 7D

**Allocation Bars** (middle):
- Horizontal bars per pool showing allocation %
- Color-coded by chain
- Label: `pool_address[:8] (chain) — XX.X% — APR YY.Y%`

**Forces** (bottom):
- 3 horizontal progress bars (0-100)
- V (volatility): low=green, mid=yellow, high=red
- M (momentum): gradient around 50 (neutral)
- T (trend): gradient around 50 (neutral)
- Decision badge with timestamp

### Right Panel — Advanced Stats

**Optimizer State:**
- Current params: baseMin, baseMax, vforceExp, vforceDivider, rsThreshold
- Fitness score, eval count
- Regime status (normal/suppressed + reason)

**Kill Switch Status:**
- Trailing 6h yield (positive=green, negative=red)
- RS count in last 4h / max 8
- 24h gas spend / budget (5% of position value)
- Active/triggered indicator

**Transaction Log:**
- Scrollable list of recent transactions
- Columns: time, type (burn/swap/mint), pool[:8], chain, status, gas

**PnL Summary:**
- Computed from tx_log: sum(outputUsd - inputUsd) grouped by period
- Display: 24h, 7d, 30d realized PnL
- Gas costs subtracted

## Dashboard Project Structure

```
dashboard/
  package.json
  vite.config.ts
  src/
    App.svelte           # Root layout (3-column)
    main.ts              # Entry point
    lib/
      api.ts             # Fetch wrapper (polling, error handling)
      types.ts           # Shared types (mirrors backend)
      stores.ts          # Svelte stores (selected pair, data)
    components/
      PairList.svelte    # Left panel
      PairItem.svelte    # Single pair in list
      PriceChart.svelte  # lightweight-charts wrapper
      Allocations.svelte # Horizontal allocation bars
      Forces.svelte      # Force progress bars + decision badge
      Optimizer.svelte   # Optimizer params display
      KillSwitch.svelte  # Kill switch status
      TxLog.svelte       # Transaction log table
      PnlSummary.svelte  # PnL display
    app.css              # Tailwind imports + custom tokens
```
