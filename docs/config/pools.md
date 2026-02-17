# Pool Registry

Registry of 41 LP pools across 7 chains and 16 DEXs, used for multi-pool allocation strategies.

## Overview

- **Total pools registered**: 41
- **Operable pools**: 40
- **Not operable**: 1 (Hybra V4 on HyperEVM -- Position Manager address not documented)

Pools are configured per pair in the `POOL_REGISTRY` map. Each pair (e.g., USDC-USDT) has a list of pools across multiple chains and DEXs that the strategy can allocate capital to.

## Pool Format

Each pool entry contains:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Pool address (V3/Algebra/LB) or bytes32 pool ID (V4) |
| `chain` | number | Chain ID |
| `dex` | string | DEX identifier from the DEX registry |

### ID Formats

- **V3 / Algebra / LB**: standard Ethereum address (42 characters, `0x` + 40 hex)
- **V4**: bytes32 hash (66 characters, `0x` + 64 hex) -- encodes the pool's `(currency0, currency1, fee, tickSpacing, hooks)` tuple

Example:
```
V3:  0x3416cF6C708Da44DB2624D63ea0AAef7113527C6
V4:  0xd49b419ced7700b88756e5c576f7a6fc165d8b4b140970ec4e6f468784c8385c
```

## Pool Distribution

| Chain | ID | DEXs |
|-------|---:|------|
| Ethereum | 1 | Uniswap V3/V4, PancakeSwap V3 |
| BNB Chain | 56 | Uniswap V3/V4, PancakeSwap V3/V4 |
| Polygon | 137 | Uniswap V3/V4, QuickSwap V3 |
| Base | 8453 | Uniswap V3/V4, Aerodrome V3, PancakeSwap V3 |
| Arbitrum | 42161 | Uniswap V3/V4, PancakeSwap V3, Camelot V3, Ramses V3 |
| Avalanche | 43114 | Uniswap V3, Pangolin V3, Blackhole V3, Pharaoh V3, Joe V2/V2.1/V2.2 |
| HyperEVM | 999 | Ramses V3, Project X V3, Hybra V4 |

## Pool Operability

A pool is considered operable if:

1. Its DEX has a registered Position Manager address for the pool's chain
2. For V4 pools: a PositionManager exists for that chain and DEX family

The only currently non-operable pool is Hybra V4 on HyperEVM (chain 999) because the V4 PositionManager address has not been publicly documented for that chain.

## Pool Loading

`toPoolConfigs(entries)` filters the registry entries:

1. For V4 pools (bytes32 ID, 66 chars): check if a V4 PositionManager exists for the chain
2. For V3/Algebra/LB pools (address, 42 chars): check if a position manager is registered in the DEX config
3. Pools without required infrastructure are skipped with a debug log

## Usage in Strategy

The strategy layer receives the pool list and runs analysis on each pool every cycle:

1. Fetch GeckoTerminal snapshot for each pool
2. Compute pool analysis (volume, utilization, APR, forces, range)
3. Allocate capital to pools via water-fill optimization
4. Mint/burn positions to match target allocation

Pools with zero volume or unreachable snapshots receive a score of 0 and are excluded from allocation.

## See Also

- [DEX Registry](./dexs.md) -- DEX IDs and Position Manager addresses
- [Chain Configuration](./chains.md) -- chain IDs and RPC endpoints
- [GeckoTerminal Integration](../data/gecko.md) -- pool snapshot data source
- [DEX Position Adapters](../execution/positions.md) -- pool-level mint/burn operations
