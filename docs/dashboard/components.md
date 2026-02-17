# Component Catalog

15 custom Svelte 5 components for the ALM dashboard. No external component library (no shadcn). All components use Svelte 5 runes (`$props`, `$state`, `$derived`, `$effect`).

## Base Components

### Section

Titled wrapper with optional empty state. Used as the standard container for all dashboard panels.

```svelte
<Section title="Active Positions" emptyText="No positions">
  <PositionList positions={data.positions} />
</Section>
```

Props: `title: string`, `emptyText?: string`, children (slot). Renders a `SECTION_HEADER` styled title, a `CARD` background container, and the empty state message when no children content is present.

### Stat / StatGrid

Key-value display for metrics. `Stat` renders a single label-value pair. `StatGrid` arranges multiple `Stat` items in a responsive grid.

```svelte
<StatGrid>
  <Stat label="TVL" value="$1.2M" />
  <Stat label="24h Volume" value="$340K" />
  <Stat label="APR" value="12.4%" trend="positive" />
</StatGrid>
```

Props: `label: string`, `value: string | number`, `trend?: "positive" | "negative" | "neutral"`. Trend colors use `text-positive` (green-400) and `text-negative` (red-400) from the theme.

### ProgressBar

Horizontal fill bar with label and percentage. Used for force indicators and allocation displays.

Props: `label: string`, `value: number` (0-100), `color?: string`. Default color is zinc-400; overridden contextually (green for bullish signals, red for bearish).

### AlertBanner

Full-width notification bar for system alerts (worker crashes, stale data, bridge pending).

Props: `message: string`, `level: "info" | "warn" | "error"`. Background color varies by level: zinc-800 (info), amber-900/20 (warn), red-900/20 (error).

## Layout Components

### PairList

Sidebar navigation listing all configured pairs. The selected pair is highlighted with a zinc-700 background. Each item shows the pair ID, current regime badge, and a status dot (green = healthy, yellow = stale, red = crashed).

Props: `pairs: Pair[]`, `selectedId: string | null`, `onSelect: (id: string) => void`.

### StrategyDetail

Center column main panel. Displays the selected pair's current strategy state: active strategy (PRA or RS), cycle number, last execution time, and summary metrics. Contains sub-sections for positions, allocations, and transaction log.

Props: `pair: PairStatus`.

### AdvancedStats

Right panel with detailed numeric breakdowns: total value locked, unrealized PnL, fee income, impermanent loss estimate, gas spent, and net return. All values formatted in monospace with appropriate decimal precision.

Props: `stats: PairStats`.

## Data Components

### PriceChart

Candlestick chart using `lightweight-charts`. Displays **M15 aggregated** candles with LP range overlays and strategy markers.

Features:
- Candlestick series with OHLC data
- Horizontal range bands showing active position tick ranges (semi-transparent blue)
- RS (Range Shift) markers: vertical lines at rebalance points
- PRA (Proactive Range Adjustment) markers: arrows at range adjustment events
- Auto-scaling Y-axis with 0.01% precision for stablecoins
- Time axis in UTC

Props: `candles: Candle[]`, `positions: Position[]`, `events: StrategyEvent[]`.

The chart initializes via `$effect` and updates reactively when candle data changes. The container resizes with the parent using a ResizeObserver.

### Forces

Three horizontal progress bars representing the strategy's force vectors:

1. **Momentum** -- short-term price direction signal
2. **Volatility** -- recent price variance relative to historical
3. **Volume** -- current volume vs. moving average

Each bar ranges from 0 to 100. Values above 60 are colored with the positive theme; below 40 with the negative theme; between 40-60 neutral.

Props: `forces: { momentum: number, volatility: number, volume: number }`.

### Allocations

Horizontal stacked bars showing capital allocation per pool. Each pool gets a segment proportional to its allocation percentage. Pools are color-coded by chain (e.g., blue for Ethereum, yellow for BSC, purple for Polygon).

Below the bar, a table lists each pool with: DEX name, chain, allocation %, and pool score.

Props: `allocations: Allocation[]`.

### PositionList

Table of active LP positions with columns: pool (DEX + chain), range (tick or bin bounds), liquidity, entry value, current value, and unrealized PnL. Rows are sorted by value descending. PnL cells use positive/negative text colors.

Props: `positions: Position[]`.

### TxLog

Scrollable table of recent transactions. Columns: time (relative, e.g., "3m ago"), type (mint/burn/swap/approve), chain icon, status badge (confirmed/reverted/pending), gas used, and TX hash (truncated, links to block explorer).

Props: `transactions: TxEntry[]`, `limit?: number` (default 20).

### PnlSummary

Compact PnL breakdown in the right panel: total PnL (USD), fee income, impermanent loss, gas costs, net return, and annualized APR. Uses positive/negative coloring for the net figure.

Props: `pnl: PnlData`.

### RegimeStatus

Displays the current market regime classification with a color-coded badge and a brief description. Regime types: `stable` (green), `trending` (blue), `volatile` (amber), `crisis` (red). Shows the regime duration (how many cycles it has been active).

Props: `regime: string`, `since: number`.

## Theme Integration

All components import style tokens from `theme.ts`:

```typescript
import { TEXT, LAYOUT, CARD, SECTION_HEADER } from './theme';
```

Token categories:
- `TEXT.primary`, `TEXT.value`, `TEXT.secondary`, `TEXT.label`, `TEXT.dim`, `TEXT.positive`, `TEXT.negative`
- `LAYOUT.gap`, `LAYOUT.padding`
- `CARD.base` -- `bg-zinc-900 border border-zinc-800 rounded-lg`
- `SECTION_HEADER.base` -- `text-sm font-medium text-zinc-400 uppercase tracking-wide`

## See Also

- [Dashboard Architecture](./overview.md) -- layout, state management, polling
- [REST API](../infrastructure/api.md) -- data endpoints for each component
- [Multi-Source OHLC](../data/ohlc.md) -- M15 candle aggregation for PriceChart
- [Observability](../infrastructure/observability.md) -- O2 streams backing positions, tx_log, allocations
- [Token Registry](../config/tokens.md) -- decimal formatting for display values
