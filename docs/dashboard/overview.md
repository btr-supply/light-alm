# Dashboard Architecture

Single-page application for monitoring and managing ALM strategy execution in real time.

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Svelte 5 | Runes API ($state, $derived, $props, $effect) |
| Styling | Tailwind CSS 4 | Utility-first, no component library |
| Build | Vite 6 | Dev server with API proxy |
| Charts | lightweight-charts | Candlestick + range overlays |
| Components | Custom | No shadcn or other UI libraries |

## Layout

Three-column responsive layout:

```
┌──────────┬────────────────────┬──────────┐
│ Sidebar  │       Main         │  Right   │
│  w-60    │     flex-1         │   w-80   │
│          │                    │          │
│ PairList │  StrategyDetail    │ Advanced │
│          │  PriceChart        │  Stats   │
│          │  Positions         │  Forces  │
│          │  Allocations       │  PnL     │
│          │  TxLog             │  Regime  │
└──────────┴────────────────────┴──────────┘
```

- **Sidebar (w-60)**: pair list navigation, orchestrator status
- **Main (flex-1)**: strategy detail, price chart, positions, allocations, transaction log
- **Right panel (w-80)**: advanced statistics, force indicators, PnL summary, regime status

On smaller screens, the right panel collapses below the main content.

## State Management

Application state is managed via a single `AppState` class using Svelte 5 runes:

```typescript
class AppState {
  pairs = $state<Pair[]>([]);
  selectedPairId = $state<string | null>(null);
  positions = $state<Position[]>([]);
  allocations = $state<Allocation[]>([]);
  candles = $state<Candle[]>([]);
  txLog = $state<TxEntry[]>([]);
  orchestratorStatus = $state<OrchestratorStatus | null>(null);

  selectedPair = $derived(/* ... */);
  // ...
}
```

`$state` provides reactive primitives. `$derived` computes values that update when dependencies change. `$effect` handles side effects like data fetching.

## Data Fetching

### Polling Strategy

The dashboard polls the REST API every **30 seconds**:

```typescript
$effect(() => {
  const interval = setInterval(() => fetchPairData(selectedPairId), 30_000);
  return () => clearInterval(interval);
});
```

### Race Prevention

A **generation-based** mechanism prevents stale responses from overwriting fresh data:

1. Each fetch increments a generation counter
2. When the response arrives, its generation is compared to the current generation
3. If the response generation is older than the current, it is discarded

This handles cases where a slow response for pair A arrives after the user has already switched to pair B.

### API Proxy

In development, Vite's dev server proxies `/api` requests to `localhost:3001`:

```typescript
// vite.config.ts
server: {
  proxy: {
    '/api': 'http://localhost:3001'
  }
}
```

In production, the SPA is served alongside the API from the same origin.

## Design System

### Typography

Monospace font stack for data-heavy display:

```css
font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
```

### Color Palette

Dark zinc theme with semantic color tokens:

| Token | Usage | Color |
|-------|-------|-------|
| `text-primary` | Main text | zinc-100 |
| `text-value` | Numeric values | zinc-200 |
| `text-secondary` | Secondary info | zinc-400 |
| `text-label` | Labels, headers | zinc-500 |
| `text-dim` | Subtle/disabled | zinc-600 |
| `text-positive` | Gains, success | green-400 |
| `text-negative` | Losses, errors | red-400 |

Card backgrounds use `zinc-900` with `zinc-800` borders. The overall page background is `zinc-950`.

### Theme Tokens

Design tokens are centralized in `theme.ts` and organized into categories:

- `TEXT` -- text color classes
- `LAYOUT` -- spacing, sizing
- `CARD` -- card backgrounds, borders, rounded corners
- `SECTION_HEADER` -- section title styling

Components import tokens from `theme.ts` rather than hardcoding Tailwind classes, ensuring visual consistency.

## Build & Development

```bash
# Development
bun run dev          # Vite dev server with HMR + API proxy

# Production build
bun run build        # Vite build to dist/

# Type check
bunx tsgo            # TypeScript type checking
```

## See Also

- [Component Catalog](./components.md) -- all 15 dashboard components
- [REST API](../infrastructure/api.md) -- endpoints consumed by the dashboard
- [Process Orchestration](../infrastructure/orchestrator.md) -- orchestrator status data
- [Multi-Source OHLC](../data/ohlc.md) -- candle data displayed in charts
