# DEX Registry

Centralized registry of 16 DEX identifiers across 6 families (V3, Algebra, Aerodrome, V4, PCS V4, LB), with ABI fragments and Position Manager addresses.

## DEX Families

### V3 Family (Standard Uniswap V3)

Standard NonfungiblePositionManager interface with `slot0()` for price, tick-aligned ranges, and ERC-721 position tokens.

| DEX ID | Name | Chains | Notes |
|--------|------|--------|-------|
| `uniswap-v3` | Uniswap V3 | Ethereum, Polygon, Arbitrum, Base | Reference implementation |
| `pancakeswap-v3` | PancakeSwap V3 | BSC, Ethereum, Arbitrum, Base | Minor ABI differences in fee encoding |
| `pangolin` | Pangolin | Avalanche | Avalanche-native |
| `pharaoh` | Pharaoh | Avalanche | Ramses fork, standard V3 (NOT Algebra despite community claims) |
| `project-x` | Project-X | BSC | |
| `ramses` | Ramses | Arbitrum | ve(3,3) model with V3 positions |
| `camelot` | Camelot | Arbitrum | Custom fee tiers |
| `quickswap` | QuickSwap | Polygon | V3 deployment |

### Algebra Family

Uses `globalState()` instead of `slot0()` for reading pool price and tick. Otherwise compatible with V3 NonfungiblePositionManager for minting and burning.

| DEX ID | Name | Chains | Notes |
|--------|------|--------|-------|
| `blackhole` | Blackhole V3 | Avalanche | Algebra Integral, NOT Uniswap V3 despite the "V3" name |

### Aerodrome Family

Concentrated liquidity with vote-escrow mechanics. Compatible interface with V3 for position management but separate factory and router contracts.

| DEX ID | Name | Chains | Notes |
|--------|------|--------|-------|
| `aerodrome` | Aerodrome | Base | ve(3,3) on Base |

### V4 Family (Singleton PositionManager)

Action-encoded multicalls to a singleton PositionManager. Pool IDs are bytes32. Must compute liquidity externally. Requires Permit2 for token approvals.

| DEX ID | Name | Chains | Notes |
|--------|------|--------|-------|
| `uniswap-v4` | Uniswap V4 | Ethereum, BSC, Polygon, Arbitrum, Avalanche | Singleton pool manager |
| `hybra-v4` | Hybra V4 | HyperEVM (999) | **Not operable** -- PM address not publicly documented |

### PCS V4 Family

PancakeSwap V4 uses a distinct `PoolKey` format with `parameters` (packed bytes32 encoding tickSpacing) and `poolManager` fields, requiring a separate adapter path from standard V4.

| DEX ID | Name | Chains | Notes |
|--------|------|--------|-------|
| `pcs-v4` | PancakeSwap V4 | BSC | Different PoolKey from Uniswap V4 |

### LB Family (Liquidity Book)

Discrete bin-based liquidity. ERC-1155 position tokens. Uniform distribution across bin ranges.

| DEX ID | Name | Chains | Notes |
|--------|------|--------|-------|
| `traderjoe-v2` | Trader Joe V2 | Avalanche | Legacy version |
| `traderjoe-v21` | Trader Joe V2.1 | Avalanche, Arbitrum, BSC | Updated router |
| `traderjoe-v22` | Trader Joe V2.2 | Avalanche, Arbitrum | Latest, improved binStep |

## ABI Centralization

ABI fragments are shared per family to avoid duplication:

- **V3 ABI**: `mint`, `decreaseLiquidity`, `collect`, `slot0`, `positions`
- **Algebra ABI**: same as V3 except `globalState` replaces `slot0`
- **V4 ABI**: `modifyLiquidities`, `positionInfo`, action constants
- **LB ABI**: `addLiquidity`, `removeLiquidity`, `getBin`, `getActiveId`

Only the fragments needed for position operations are included (not full contract ABIs).

## Position Manager Addresses

Each DEX+chain combination has a registered PositionManager (or Router for LB) address. These are stored in a lookup map:

```typescript
PM_ADDRESSES[dexId][chainId] → address
```

If no address is registered for a DEX+chain combination, the pool is marked as **not operable**. Currently, only Hybra V4 on HyperEVM (999) is missing its PM address.

## Key Gotchas

1. **Blackhole is Algebra, not V3**: despite being branded "Blackhole V3", it uses the Algebra Integral architecture. Pool reads must use `globalState()` not `slot0()`.

2. **Pharaoh is standard V3**: despite some community documentation claiming Algebra compatibility, Pharaoh is a Ramses fork using standard Uniswap V3 interfaces.

3. **V4 liquidity computation**: V3 PositionManagers compute liquidity from amounts internally. V4 does not. The adapter must call `computeLiquidity()` before encoding the mint action.

4. **PancakeSwap V3 fee encoding**: PCS V3 uses a slightly different fee parameter encoding in the mint call compared to Uniswap V3.

## See Also

- [DEX Position Adapters](../execution/positions.md) -- family-specific adapter logic
- [Pool Registry](./pools.md) -- pools per DEX
- [Chain Configuration](./chains.md) -- chains where each DEX operates
- [TX Lifecycle](../execution/transactions.md) -- how PM calls are submitted
