# System Overview

BTR Agentic ALM is an autonomous concentrated-liquidity management system. It manages LP positions across 7 EVM chains and 16 DEXs (41 pools), executing rebalancing decisions every 15 minutes with no human intervention.

## What It Does

A single EOA (Externally Owned Account) per asset pair controls all positions for that pair across every supported chain and DEX. Each cycle follows five steps:

1. **Fetch** -- pull M1 OHLC candles from CEXes (via ccxt) and pool snapshots from GeckoTerminal
2. **Compute** -- calculate 3-force signals, run pool analysis, optimize range parameters, allocate capital via water-fill
3. **Decide** -- compare current positions against optimal allocation; choose PRA, RS, or HOLD
4. **Execute** -- burn outdated positions, swap/bridge tokens if needed, mint new positions
5. **Log** -- ingest results to OpenObserve, publish state to DragonflyDB

## Supported Chains

| Chain | ID | Native |
|-------|----|--------|
| Ethereum | 1 | ETH |
| BSC | 56 | BNB |
| Polygon | 137 | POL |
| Base | 8453 | ETH |
| Arbitrum | 42161 | ETH |
| Avalanche | 43114 | AVAX |
| HyperEVM | 999 | HYPE |

## DEX Families

| Family | Protocol Examples |
|--------|-------------------|
| V3 | Uniswap V3, PancakeSwap V3, Pharaoh, Ramses, Pangolin, Project X |
| Algebra | Blackhole V3 (Algebra Integral), Camelot V3, QuickSwap V3 |
| Aerodrome | Aerodrome V3 (Base) |
| V4 | Uniswap V4, PancakeSwap V4 |
| LB | Trader Joe V2/V2.1/V2.2 (Liquidity Book) |

## Key Differentiators

- **Multi-timeframe 3-force model**: volatility, momentum, and trend signals blended across M15/H1/H4 timeframes eliminate microstructure noise while capturing regime shifts.
- **Nelder-Mead online optimization**: 5 range parameters are continuously tuned against a fitness function that balances fee APR against LVR and rebalancing costs. Budget: 300 evaluations per epoch.
- **Water-fill allocation**: concave optimizer equalizes marginal APR across pools, accounting for TVL-based dilution.
- **Multi-DEX multi-chain**: a single pair can hold positions on Uniswap V3 (Ethereum), PancakeSwap V3 (BSC), and Trader Joe LB (Avalanche) simultaneously.
- **Regime detection and kill-switches**: circuit breakers suppress optimization during volatility spikes, price displacements, and volume anomalies. Kill-switches revert to safe defaults on excessive RS, negative yields, or gas budget overruns.

## See Also

- [Architecture](architecture.md) -- process topology and module map
- [3-Force Model](strategy/forces.md) -- the signal engine
- [Decision Engine](strategy/decision.md) -- PRA / RS / HOLD logic
- [Glossary](glossary.md) -- domain term definitions
