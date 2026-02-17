# BTR Light ALM Documentation

## General

| Page | Description |
|------|-------------|
| [System Overview](overview.md) | What BTR Light ALM does and key differentiators |
| [Architecture](architecture.md) | Process topology, data flow, module map, tech stack |
| [Glossary](glossary.md) | Domain terms and abbreviations |

## Strategy

| Page | Description |
|------|-------------|
| [3-Force Model](strategy/forces.md) | Volatility, momentum, and trend force computation |
| [Range Computation](strategy/range.md) | Converting forces into tick-aligned price ranges |
| [Range Optimizer](strategy/optimizer.md) | Nelder-Mead online parameter tuning with regime detection |
| [Water-Fill Allocation](strategy/allocation.md) | Concave optimization for multi-pool capital distribution |
| [Decision Engine](strategy/decision.md) | PRA / RS / HOLD decision logic and thresholds |

## Execution

| Page | Description |
|------|-------------|
| [Position Adapters](execution/positions.md) | V3, Algebra, V4, and LB mint/burn dispatching |
| [Token Rebalancing](execution/swap.md) | Cross-chain swaps via Li.Fi/Jumper, imbalance threshold |
| [TX Lifecycle](execution/transactions.md) | Simulation, gas buffer, receipt timeout, error handling |

## Data

| Page | Description |
|------|-------------|
| [Multi-Source OHLC](data/ohlc.md) | Weighted M1 candles via ccxt, backfill, aggregation |
| [Observability](infrastructure/observability.md) | 9 O2 streams, buffered ingestion, SQL queries |
| [GeckoTerminal](data/gecko.md) | Pool snapshots, interval volume diffing |

## Infrastructure

| Page | Description |
|------|-------------|
| [Process Orchestration](infrastructure/orchestrator.md) | Worker spawning, DragonflyDB locks, health monitoring |
| [REST API](infrastructure/api.md) | Endpoints, dual-mode, authentication |
| [Observability](infrastructure/observability.md) | Structured logger, OpenObserve buffered ingestion |

## Configuration

| Page | Description |
|------|-------------|
| [Chains](config/chains.md) | 7 EVM chains, RPC endpoints, block times |
| [DEX Registry](config/dexs.md) | 16 DEXes across 6 families, ABI centralization |
| [Pool Registry](config/pools.md) | 41 pools, ID formats, env var overrides |
| [Token Registry](config/tokens.md) | Decimals, BSC 18-decimal gotcha, addresses |

## Dashboard

| Page | Description |
|------|-------------|
| [Architecture](dashboard/overview.md) | Svelte 5 + Tailwind 4 SPA, polling, state management |
| [Component Catalog](dashboard/components.md) | 15 custom components with theme token integration |

## Migration

| Page | Description |
|------|-------------|
| [EOA to Smart Accounts](migration-smart-accounts.md) | Safe vaults, BTRPolicyModule, Li.Fi verification, implementation phases |
