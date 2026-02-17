# Chain Configuration

EVM chain definitions, RPC endpoints, and GeckoTerminal network mappings.

## Supported Chains

| Chain | Chain ID | Block Time | Native Token | GeckoTerminal Slug |
|-------|----------|------------|-------------|-------------------|
| Ethereum | 1 | 12s | ETH | `eth` |
| BSC | 56 | 3s | BNB | `bsc` |
| Polygon | 137 | 2s | POL | `polygon_pos` |
| Base | 8453 | 2s | ETH | `base` |
| Arbitrum | 42161 | 0.25s | ETH | `arbitrum` |
| Avalanche | 43114 | 2s | AVAX | `avax` |
| HyperEVM | 999 | 2s | HYPE | `hyperevm` |

## RPC Configuration

Each chain has a default public RPC endpoint. Production deployments should override these with private RPC URLs via environment variables for reliability and rate limit headroom.

### Environment Variables

| Env Var | Chain | Example |
|---------|-------|---------|
| `RPC_ETHEREUM` | Ethereum (1) | `https://eth.llamarpc.com` |
| `RPC_BNB` | BSC (56) | `https://bsc-dataseed.binance.org` |
| `RPC_POLYGON` | Polygon (137) | `https://polygon-rpc.com` |
| `RPC_BASE` | Base (8453) | `https://mainnet.base.org` |
| `RPC_ARBITRUM` | Arbitrum (42161) | `https://arb1.arbitrum.io/rpc` |
| `RPC_AVALANCHE` | Avalanche (43114) | `https://api.avax.network/ext/bc/C/rpc` |
| `RPC_HYPEREVM` | HyperEVM (999) | `https://rpc.hyperliquid.xyz/evm` |

If the environment variable is not set, the built-in default RPC is used. Defaults are public endpoints suitable for development but not production traffic.

## Chain Properties

### Block Time Implications

Block time affects gas estimation, receipt polling, and transaction confirmation expectations:

- **Arbitrum (0.25s)**: near-instant confirmations, but high state contention. Gas buffer of 120% is essential due to rapid state changes between estimation and mining.
- **Ethereum (12s)**: longest confirmation time. Receipt polling runs for up to 120s (roughly 10 blocks).
- **BSC (3s)**: uses legacy gas pricing (no EIP-1559). The TX layer handles this automatically.

### GeckoTerminal Slug

The `geckoSlug` property maps each chain to GeckoTerminal's network identifier used in API URLs:

```
https://api.geckoterminal.com/api/v2/networks/{geckoSlug}/pools/{address}
```

### Native Token

The native token symbol is used for gas cost estimation and display purposes. It does not affect execution logic since all LP operations use ERC-20 tokens.

## Chain Registry Access

The chain configuration is accessed via `getChain(chainId)` which returns the full chain object, or throws if the chain ID is not supported.

```typescript
const chain = getChain(56);
// { id: 56, name: "BSC", blockTimeMs: 3000, rpc: "...", gecko: "bsc", nativeSymbol: "BNB" }
```

## Adding a New Chain

To add a new chain:

1. Add the chain definition to the registry in `src/config/chains.ts`
2. Add the RPC env var override
3. Add the GeckoTerminal slug mapping
4. Register pools on the new chain in `src/config/pools.ts`
5. Verify DEX support on the chain in `src/config/dexs.ts`

## See Also

- [DEX Registry](./dexs.md) -- DEXs available per chain
- [Pool Registry](./pools.md) -- pools deployed on each chain
- [Token Registry](./tokens.md) -- token addresses per chain
- [GeckoTerminal Integration](../data/gecko.md) -- uses geckoSlug for API calls
- [TX Lifecycle](../execution/transactions.md) -- gas estimation varies by chain block time
