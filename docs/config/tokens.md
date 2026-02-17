# Token Registry

Token definitions with per-chain addresses and decimal overrides for safe cross-chain arithmetic.

## Supported Tokens

| Symbol | Base Decimals | Description |
|--------|--------------|-------------|
| USDC | 6 | USD Coin (Circle) |
| USDT | 6 | Tether USD |
| USDC.e | 6 | Bridged USDC |
| USDT.e | 6 | Bridged USDT |

## Per-Chain Addresses

Each token has a registered contract address per chain. Tokens not deployed on a given chain are absent from the map.

### USDC

| Chain | Address | Decimals |
|-------|---------|----------|
| Ethereum (1) | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | 6 |
| BSC (56) | `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d` | **18** |
| Polygon (137) | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` | 6 |
| Base (8453) | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | 6 |
| Arbitrum (42161) | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | 6 |
| Avalanche (43114) | `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E` | 6 |
| HyperEVM (999) | `0x6B2e0fACD2B7c26Ea603639d4c1A5fafCBBf5053` | 6 |

### USDT

| Chain | Address | Decimals |
|-------|---------|----------|
| Ethereum (1) | `0xdAC17F958D2ee523a2206206994597C13D831ec7` | 6 |
| BSC (56) | `0x55d398326f99059fF775485246999027B3197955` | **18** |
| Polygon (137) | `0xc2132D05D31c914a87C6611C10748AEb04B58e8F` | 6 |
| Base (8453) | `0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2` | 6 |
| Arbitrum (42161) | `0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9` | 6 |
| Avalanche (43114) | `0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7` | 6 |

Note: USDT is not deployed on HyperEVM (999) -- omitted to prevent zero-address operations.

## Critical: BSC Decimal Override

BSC USDC and USDT use **18 decimals**, not the standard 6. This is because BSC deployed BEP-20 wrapped versions of these tokens with 18-decimal precision.

**Never hardcode 6 decimals.** Always use `tokenDecimals(token, chainId)`:

```typescript
const decimals = tokenDecimals(USDC, 56);  // returns 18
const decimals = tokenDecimals(USDC, 1);   // returns 6
```

Hardcoding decimals will cause:
- **Off by 10^12** on BSC -- minting with 6-decimal amounts on an 18-decimal token
- Silent failures where transactions succeed but with dust-level amounts
- Incorrect position valuation and PnL calculation

## Helper Functions

### `tokenDecimals(token: TokenConfig, chain: number): number`

Returns the correct decimal count for a token on a specific chain. Uses the `chainDecimals` override map if present, otherwise falls back to the token's base `decimals`.

```typescript
export function tokenDecimals(token: TokenConfig, chain: number): number {
  return token.chainDecimals?.[chain] ?? token.decimals;
}
```

### `computeEntryValueUsd(pair, chain, amount0, amount1): number`

Computes the USD value of a position entry given both token amounts. Handles decimal normalization internally. Assumes stablecoin tokens where 1 token ~ $1:

```typescript
export function computeEntryValueUsd(
  pair: { token0: TokenConfig; token1: TokenConfig },
  chain: number,
  amount0: bigint,
  amount1: bigint,
): number
```

For stablecoin pairs, the result is `amount0_normalized + amount1_normalized` (both in human-readable units).

## Bridged Tokens

USDC.e and USDT.e are bridged versions of USDC and USDT, typically found on L2s and alt-L1s (Avalanche, Polygon, Arbitrum). They maintain 6 decimals across all chains. The strategy treats native and bridged versions as equivalent for allocation purposes but tracks them as separate tokens for position accounting.

## Adding a New Token

1. Add the token entry to the registry in `src/config/tokens.ts`
2. Include per-chain addresses and decimal overrides
3. Verify decimals on-chain (`decimals()` call) for every chain
4. Update pair configurations if the token participates in new pairs

## See Also

- [Chain Configuration](./chains.md) -- chain IDs for token lookups
- [Pool Registry](./pools.md) -- pools using these tokens
- [DEX Position Adapters](../execution/positions.md) -- amount encoding uses token decimals
- [Token Rebalancing](../execution/swap.md) -- swap amounts normalized via token decimals
