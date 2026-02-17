# BTR Agentic ALM

Autonomous concentrated liquidity management across 7 EVM chains and 20+ DEXes.

## Quick Links

- [Architecture Overview](docs/architecture.md)
- [Strategy: Force Model](docs/strategy/forces.md)
- [Strategy: Range Optimizer](docs/strategy/optimizer.md)
- [Execution: Position Adapters](docs/execution/positions.md)
- [API Reference](docs/infrastructure/api.md)
- [Dashboard Guide](docs/dashboard/overview.md)
- [Full Documentation Index](docs/index.md)

## Getting Started

```bash
bun install
bun run start          # Single-instance CLI
bun run orchestrate    # Multi-worker orchestrator
bun test               # Run test suite
```

### Dashboard

```bash
cd dashboard && bun install && bun run dev
```

Open `http://localhost:5173`. Press `Cmd+K` to search documentation.

## How It Works

Every 15 minutes per asset pair:

1. **Fetch** — OHLC candles (ccxt) + pool snapshots (GeckoTerminal)
2. **Compute** — 3-force model (volatility, momentum, trend) across M15/H1/H4
3. **Optimize** — Nelder-Mead tunes 5 range parameters, water-fill allocates capital
4. **Decide** — PRA (pool reallocation), RS (range shift), or HOLD
5. **Execute** — Burn, swap (Li.Fi/Jumper), mint across V3/V4/LB DEXes

## Documentation

All documentation lives in [`docs/`](docs/index.md), viewable on GitHub or in the dashboard docs viewer.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.
