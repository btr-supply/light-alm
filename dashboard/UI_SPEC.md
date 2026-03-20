# Dashboard UI Spec — ALM Terminal

## Layout: 3-Panel + Bottom Section

```
+-------+---------------------------------------------+-----------+
| LEFT  |              MID PANEL (flex-1)              |   RIGHT   |
| w-52  |                                              |   w-64    |
|       | +-------------------------------------------+|           |
|Strats | | Price Chart (30%, min 250px)              ||  Strategy |
|       | | - candles + overlays + density sidebar    ||  metadata |
|       | +-------------------------------------------+|  details  |
|       | | Secondary Chart (15%, min 120px)          ||  config   |
|       | | - APR / Perf % / TVL tab-switched         ||  actions  |
|       | +-------------------------------------------+|  (accord) |
|       | | Allocation | Divergence (side-by-side)    ||           |
|Workers| | (collapsible, 15%, min 120px)             ||           |
|       | +-------------------------------------------+|           |
|       | | Bottom Table (40%, min 200px)             ||           |
|       | | - Exposure | TxLog tab-switched           ||           |
+-------+---------------------------------------------+-----------+
```

**Height budget** (1080p, ~1030px usable after header, ~60/40 charts/tables):
- Price chart: 30% = ~310px
- Secondary: 15% = ~155px
- Tertiary: 15% = ~155px (collapsible)
- Table: 40% = ~410px (~15-20 rows visible)

**Responsive breakpoints:**
- `>= lg` (1024px): Full 3-panel + 4-row layout as above
- `md-lg` (768-1024px): Right panel hidden. Tertiary charts merge into secondary chart tabs (APR | TVL | Allocation | Divergence — one chart at a time, not side-by-side)
- `< md` (mobile): Sidebar overlay. Only price chart + table. Secondary/tertiary behind "Charts" tab

---

## MID PANEL

### 1. Price Chart (top, ~45%)

**Already implemented:**
- Candlestick OHLC (adaptive bucketing: 5m/1h/4h)
- Position range bands (blue, from tickLower/tickUpper)
- Optimal range lines (emerald, from `/optimal-ranges`)
- Range history lines (emerald dashed, from `/analyses`)
- MA overlays (8-period orange, 16-period gray)
- RS/PRA decision markers
- Price density canvas (30-bin histogram, right side)

**Additions:**
- Density histogram center line: MTF weighted-average price (from existing MA computation)

**Deferred (v2):**
- Optimization cycle vertical markers — range history lines already convey this implicitly
- Crosshair sync with secondary/tertiary charts

**Data sources (all available):**
- `GET /strategies/{name}/candles?from=X&to=Y` — Candle[]
- `GET /strategies/{name}/optimal-ranges` — OptimalRange[]
- `GET /strategies/{name}/analyses?from=X&to=Y` — PoolAnalysis[]
  - BACKEND FIX: Add `analyses` sub-route to strategy routing (currently only on pair routing)
- `GET /strategies/{name}/positions` — Position[]
- `GET /strategies/{name}/txlog` — TxLogEntry[] (for decision markers)

### 2. Secondary Chart (below price, ~25%, linked x-axis)

**Tab-switched modes:** `APR` | `Perf %` | `TVL`

#### APR mode (default)
- Two `LineSeries`: `currentApr` (blue) and `optimalApr` (emerald)
- Decision markers: dots colored by decision type (HOLD=emerald, RS=amber, PRA=red)

**Note:** Filled area between two arbitrary lines is not natively supported by lightweight-charts v5. Use two plain LineSeries. If fill is desired later, implement via `ISeriesPrimitive` custom canvas drawing.

**Data:** `GET /strategies/{name}/snapshots?from=X&to=Y` → `EpochSnapshot[]`
- Fields: `ts`, `currentApr`, `optimalApr`, `decision`
- BACKEND FIX: Add `snapshots` sub-route to strategy routing

#### Perf % mode
- Single `AreaSeries` (emerald): cumulative `netPnlUsd / initialPortfolioValueUsd * 100`
- Shows percentage return over time from the first epoch snapshot

#### TVL mode
- Single `AreaSeries`: `portfolioValueUsd` over time
- Dropdown to switch denomination: `USD` | `Token A` | `Token B`
  - Token A: divide `portfolioValueUsd` by `PoolAnalysis.basePriceUsd`
  - Token B: divide `portfolioValueUsd` by `basePriceUsd * exchangeRate`

**Data:** Same `EpochSnapshot[]` — field `portfolioValueUsd`

**Deferred (v2) — Token Ratio tab:**
- Requires `amount0Total`/`amount1Total` added to `EpochSnapshot` backend-side
- Use two stacked `AreaSeries` (NOT `HistogramSeries`)
- Ship once backend type is extended

### 3. Tertiary Charts (below secondary, ~15%, two side-by-side)

**Collapsible** — can be hidden to give more space to price/secondary charts.

#### 3a. Allocation Over Time (left half)
- Stacked `AreaSeries` (cumulative values) showing allocation % per pool over time
- Dropdown: group by `Pool` (default) | `DEX` | `Chain`
- Custom legend component (lightweight-charts has no built-in legend for stacked areas)
- Custom tooltip via `subscribeCrosshairMove` (default tooltip shows cumulative, not individual segment values)

**Complexity note:** This is the hardest chart. Multiple AreaSeries with cumulative data, custom legend, custom tooltip, re-teardown on grouping change.

**Data:** `GET /strategies/{name}/allocations?limit=500` → `PairAllocation[]`
- Each has `targetAllocations: AllocationEntry[]` with `pool`, `chain`, `dex`, `pct`
- BACKEND FIX: Add `from`/`to` time-range params to `getPairAllocations()` in store-o2.ts

#### 3b. Divergence Over Time (right half)
- Two `LineSeries`:
  - **Range divergence**: `1 - rangeEfficiency` from `EpochSnapshot`
  - **Allocation divergence**: L1 distance / 2 from `PairAllocation.currentAllocations` vs `targetAllocations`
- Horizontal threshold lines via `createPriceLine`: `rsThreshold` from optimizer params, `praThreshold` from strategy config

**Data:** `EpochSnapshot[]` (rangeEfficiency) + `PairAllocation[]` (allocation comparison)

### 4. Bottom Table (bottom, ~15%)

**Tab-switched modes:** `Exposure` | `Tx Log` | `Operations`

#### Exposure tab (default)
Table of current positions with all available fields:

| Pool | Chain | DEX | Ticks | Entry APR | Entry Price | Entry Time | Value USD | Liquidity |
|------|-------|-----|-------|-----------|-------------|------------|-----------|-----------|

- Dropdown: view by `Pool` (default) | `Token` | `Chain` (aggregated)
- Token view: aggregate amount0/amount1 per token
- Chain view: aggregate value per chain

**Data:** `Position[]` — uses currently-unused fields: `liquidity`, `entryPrice`, `entryTs`, `entryValueUsd`, `amount0`, `amount1`, `dex`

#### Tx Log tab
Enhanced transaction table:

| Time | Decision | Op | Pool | Chain | Tokens | Amount | Gas | Status | TxHash |
|------|----------|----|------|-------|--------|--------|-----|--------|--------|

- `decisionType` badge (PRA/RS colored)
- Token pair: `inputToken` → `outputToken` with USD values
- Clickable txHash (link to block explorer)
- Status indicator (green check / red x)

**Data:** `TxLogEntry[]` — using all currently-unused fields

#### Operations tab (deferred until backend adds `operationId`)
Groups transactions into logical operation bundles:

| Time | Decision | # Txs | Pools | Gas Cost | Alloc Error | Status |
|------|----------|-------|-------|----------|-------------|--------|

- Requires `operationId` field on `TxLogEntry` for reliable grouping
- Client-side timestamp-proximity grouping is fragile (cross-chain latency, overlapping operations)
- Ship once backend adds `operationId` to execution pipeline

---

## RIGHT PANEL (w-64, accordion sections)

Sections are collapsible. Default expanded: Metadata + Performance.

### Strategy Metadata (expanded by default)
- Strategy name + pair ID
- Decision badge (HOLD/RS/PRA) + timestamp
- Epoch number
- Status badge (running/paused/stopped/error)
- Runtime / uptime (from `ClusterWorker.uptimeMs`, matched by worker id)
- EOA env var name (from `StrategyConfigEntry.pkEnvVar`)

### Performance Summary (expanded by default)
- Current APR vs Optimal APR (with delta)
- Net PnL (from `EpochSnapshot`: fees - gas - IL)
- Range efficiency %
- Total positions count + total value USD

### Optimizer State (collapsed by default)
- Params grid: baseMin, baseMax, vforceExp, vforceDivider, rsThreshold, fitness
- Regime status: normal/suppressed + reason + widen factor
- Kill switch: alert if active

### Forces (collapsed by default)
- V/M/T force bars with values (existing component, moved here)

### Config Summary (collapsed by default)
- Interval (sec), Max positions
- PRA threshold / RS threshold
- Pool count + pool list (abbreviated)
- Gas reserves per chain

### Action Buttons (always visible, pinned to top or header)
- Start / Stop / Pause / Restart (existing WorkerControls)
- Copy EOA address

---

## LEFT PANEL (w-52) — already implemented

### Strategies section (top, flex-1)
- Strategy list with name, pair, status dot, APR, positions, epoch
- Click to select → loads all data in mid/right panels

### Workers section (bottom, flex-1)
- Compact worker rows: [dot] name [type] [uptime] [controls]
- Cluster summary: total workers, uptime

---

## SHARED INFRASTRUCTURE

### ChartContainer.svelte (new)
Eliminates chart boilerplate duplication across 4 chart components:
- `createChart` with standard `CHART` theme options
- `ResizeObserver` for width, percentage-based height
- `onMount`/`onDestroy` lifecycle management
- Exposes `IChartApi` via callback prop
- Linked time scale: registers/deregisters from shared chart sync store

### TabBar.svelte (new)
Reusable tab switcher for:
- Secondary chart mode tabs (APR | TVL)
- Bottom table tabs (Exposure | Tx Log | Operations)
- Time range selector (1h | 6h | 24h | 7d | 30d)

### Chart sync store (new)
Svelte store holding array of `IChartApi` refs for linked x-axis scrolling:
- Charts register on mount, deregister on unmount
- `subscribeVisibleLogicalRangeChange` on leader chart propagates to followers
- Guard against feedback loops (flag to skip re-broadcast)
- Debounce with `requestAnimationFrame`

---

## BACKEND FIXES REQUIRED

### Blocking (must do before dashboard work)

1. **Add `snapshots` route to strategy routing** (`src/api.ts`)
   - Same pattern as pair `snapshots` case: resolve `pairId` from `workerState`, delegate to `o2q.getEpochSnapshots()`
   - Blocks: Secondary Chart, Divergence chart, Performance Summary panel

2. **Add `analyses` route to strategy routing** (`src/api.ts`)
   - Dashboard API client already calls it, currently 404s
   - Blocks: Range history overlay (currently silently failing with `.catch()`)

3. **Add `from`/`to` time-range params to allocations** (`src/data/store-o2.ts`)
   - `getPairAllocations()` currently only supports `limit`
   - Blocks: Allocation chart linked scrolling with price chart

### Type fixes

4. **`StrategySummary`** — add `decisionTs: number` (API returns it, type omits it)
5. **`StrategyStatus`** — add `status: string`, `currentApr: number`, `optimalApr: number` (API returns them, type omits them)
6. **`TxLogEntry.id`** — make optional or populate in O2 query (declared required, never populated)

### Deferred backend additions

7. **`operationId: string`** on `TxLogEntry` — UUID shared across all txs in same decision execution. Enables Operations tab.
8. **`amount0Total`/`amount1Total`** on `EpochSnapshot` — enables Token Ratio chart mode.
9. **`gasCostUsd: number`** on `TxLogEntry` — avoids needing native token price lookup for USD gas display.

---

## STORE + API CHANGES

### Dashboard API client additions (`dashboard/src/lib/api.ts`)
```typescript
strategySnapshots: (name: string, from: number, to: number, limit?: number) =>
  get<EpochSnapshot[]>(`/strategies/${name}/snapshots?from=${from}&to=${to}${limit ? `&limit=${limit}` : ''}`),
strategyAllocationsHistory: (name: string, limit = 500) =>
  get<PairAllocation[]>(`/strategies/${name}/allocations?limit=${limit}`),
```

### Store additions (`dashboard/src/lib/stores.svelte.ts`)
```typescript
epochSnapshots = $state<EpochSnapshot[]>([]);
allocationHistory = $state<PairAllocation[]>([]);
analyses = $state<PoolAnalysis[]>([]);  // full analyses, not just rangeHistory extraction
```

Add to `refreshStrategyData()` parallel fetch batch (brings total to 10 concurrent calls).

**Per-chart error isolation:** Each fetch should `.catch()` independently so a failing snapshots endpoint doesn't prevent candles from loading.

---

## COMPONENT MAP

### New components:
| Component | Purpose | Complexity |
|-----------|---------|------------|
| `ChartContainer.svelte` | Shared chart wrapper (lifecycle, resize, theme, sync) | Low |
| `TabBar.svelte` | Reusable tab switcher | Low |
| `SecondaryChart.svelte` | APR/TVL chart with tab switching | Medium |
| `AllocationChart.svelte` | Stacked area allocation over time | High |
| `DivergenceChart.svelte` | Range + allocation divergence lines | Low |
| `ExposureTable.svelte` | Position exposure table with grouping | Medium |
| `StrategyPanel.svelte` | Right panel: accordion sections | Medium |

### Modified components:
| Component | Changes |
|-----------|---------|
| `StrategyDetail.svelte` | New layout: 4-section vertical split |
| `PriceChart.svelte` | Add MTF center line to density |
| `TxLog.svelte` | Enhance with all unused fields, move to table tabs |

### Removed components:
| Component | Reason |
|-----------|--------|
| `AdvancedStats.svelte` | Replaced by `StrategyPanel.svelte` |
| `Allocations.svelte` | Replaced by `AllocationChart.svelte` |
| `Forces.svelte` | Moved into `StrategyPanel.svelte` |
| `PnlSummary.svelte` | Moved into `StrategyPanel.svelte` using EpochSnapshot data |
| `DoughnutChart.svelte` | Replaced by stacked area chart (keep if current-snapshot thumbnail desired in right panel) |

---

## IMPLEMENTATION ORDER

1. **Backend: Add missing strategy routes** (`snapshots`, `analyses`, allocation time-range)
2. **Backend: Fix shared types** (`StrategySummary`, `StrategyStatus`, `TxLogEntry.id`)
3. **Shared infra: `ChartContainer`, `TabBar`, chart sync store**
4. **Store + API: Add new data fields and fetch calls**
5. **Right panel: `StrategyPanel`** (replaces `AdvancedStats`)
6. **Bottom table: `ExposureTable` + enhanced `TxLog`** (tab-switched)
7. **Secondary chart: APR/TVL**
8. **Tertiary charts: Divergence** (simpler) then **Allocation** (hardest)
9. **Chart x-axis linking + crosshair sync**
10. **Price chart enhancements** (MTF center line)

---

## OPEN QUESTIONS FOR USER

1. **Token A/B ratio**: `EpochSnapshot` lacks per-token amounts. Should we add `amount0Total`/`amount1Total` to the backend now, or defer the Token Ratio tab entirely?

2. **Operation bundling**: Should we add `operationId` to `TxLogEntry` in the backend execution pipeline now, or ship without the Operations tab and add it later?

3. **Allocation time range**: Should `/allocations` support `from`/`to` params (needed for linked scrolling), or is `limit=500` sufficient for now?

4. **Tertiary row**: Should the Allocation + Divergence charts be always visible (side-by-side, taking 15% height), or should they merge into the secondary chart's tab bar as additional modes (saves vertical space, simpler on smaller screens)?

5. **Right panel actions**: Should Start/Stop/Pause/Restart buttons be in the right panel accordion, or pinned to the header bar next to the strategy name for faster access?
