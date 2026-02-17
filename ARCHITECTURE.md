# BTR Agentic ALM - Architecture & Requirements

## 1. Executive Summary

BTR Agentic is a lightweight, autonomous liquidity management protocol that uses a single EOA per asset pair to manage concentrated liquidity positions across multiple chains and DEXes. Every configurable interval (default 15min), the system:

1. **Fetches** 24h volume data from GeckoTerminal for all tracked pools of a pair
2. **Computes** real-time utilization (APR) per pool: `(volume * feeTier) / TVL * (365 * 24 * 4)`
3. **Optimizes** allocation across the top-N pools (default 3) to maximize aggregate APR
4. **Evaluates** optimal range breadth using BTR's 3-force model (volatility, momentum, trend)
5. **Decides** whether to rebalance: Range-Shift (RS) or Pool Re-Allocation (PRA) or hold
6. **Executes** on-chain transactions via the pair's EOA (withdraw, swap, re-enter)

---

## 2. Research Findings (Existing Codebase)

### 2.1 GeckoTerminal API (`~/Work/btr/markets/back/ingesters/generators/dexs/pool_fetcher.py`)

- **Base URL**: `https://app.geckoterminal.com/api/p1`
- **Pools endpoint**: `/pools` with params: `include=dex,dex.network,tokens`, pagination, volume/TVL filters, sort by `-24h_volume`
- **Data returned per pool**: `from_volume_in_usd` (24h volume), `reserve_in_usd` (TVL), dex identifier, network identifier, token addresses
- **Rate limiting**: 30 req/min via shared client with exponential backoff, random delays (100-500ms), retry on 429/5xx
- **Network normalization**: `eth`->`ethereum`, `bsc`->`bnb-chain`, `polygon_pos`->`polygon`, `avax`->`avalanche`

**Key insight for our use case**: GeckoTerminal returns cumulative 24h figures. To get interval volume (15min), we must store the previous snapshot and subtract: `interval_volume = current_24h_volume - previous_24h_volume`. If the diff is negative (24h window rolled), fallback to `current_24h_volume / 96` (24h / 15min intervals).

### 2.2 BTR Force Model (`~/Work/btr/front/src/lib/btr/`)

Three forces on 0-100 scale determine range breadth:

- **Volatility (vforce)**: Normalized standard deviation of prices over lookback period. `force = (std / mean) * 100`. Higher = wider range needed.
- **Momentum (mforce)**: RSI-based. 50=neutral, >60=overbought, <40=oversold. Affects confidence and trend bias.
- **Trend (tforce)**: Short MA vs Long MA ratio. 50=neutral, >60=bullish, <40=bearish. Determines range asymmetry (bias).

**Range calculation flow**:
1. `volatilityToBaseRange(v)` -> base range width (wider for higher vol)
2. Trend bias `[-1,1]` from tforce + confidence scaling -> asymmetric range (bullish=wider upside)
3. Confidence decreases with high vforce and mforce divergence from trend
4. Final range: `[price - rMin, price + rMax]` where rMin/rMax are bias-adjusted

**Range divergence** triggers rebalancing when `sizeDiff + centerDiff > threshold` (default 25%).

**Default params**: vforce lookback=24, mforce lookback=24 (RSI period=14), tforce lookback=36 (short=12, long=24).

### 2.3 BTR Swap SDK (`~/Work/btr/swap`)

- **Package**: `@btr-supply/swap` (monorepo: packages/core + packages/cli)
- **Aggregators**: LiFi, Socket, Squid, Rango (cross-chain meta-aggregators) + 1inch, 0x, ParaSwap, Odos, KyberSwap, OpenOcean, Firebird (same-chain)
- **Interface**: `IBtrSwapParams` -> `ITransactionRequestWithEstimate` (tx data + estimates + steps)
- **Cross-chain**: Supported via LiFi, Socket, Squid, Rango bridges
- **Built with**: Bun, TypeScript
- **Usage**: Provide input/output tokens, amounts, payer address -> get ranked transaction requests

### 2.4 Data Collector (`~/Work/btr/dex/back/services/collector/`)

- **Pattern**: Weighted multi-source aggregation via ccxt REST API (no WebSockets needed for 15min intervals)
- **Config**: `Record<PairSymbol, { sources: Record<sourceKey, { weight }> }>` per pair
- **Storage**: SQLite with M1 OHLC candles, gap filling from exchange REST APIs
- **Timeframes**: M1, M5, M15, M30, H1, H4, H12 (higher TFs reconstructed on-demand)
- **Source format**: `exchange:type:PAIR` (e.g., `binance:spot:BTCUSDT`) with weight per source

### 2.5 DEX Adapters (`~/Work/btr/supply/contracts/evm/src/adapters/dexs/`)

Supported DEXes with concentrated liquidity (all V3/V4-style):
- **Uniswap V3/V4**, **PancakeSwap V3/V4**, **Algebra V3/V4** (dynamic fee)
- **Aerodrome V3**, **Velodrome V3**, **Ramses V3**, **Camelot V3**
- **Thena V3**, **Kodiak V3**, **SolidlyV3**, **QuickSwap V3**
- **Shadow V3**, **Pharaoh V3**, **Equalizer V3**, **SwapX V4**
- **Trader Joe V2** (LB), **Merchant Moe V2** (LB)

Common interface pattern: `poolState()` -> `(sqrtPriceX96, tick)`, tick-based ranges, mint/burn/collect for position management.

---

## 3. System Architecture

### 3.1 High-Level Architecture Diagram

```
+------------------------------------------------------------------+
|                        BTR Agentic CLI                            |
|                     (Bun runtime, no frontend)                    |
+------------------------------------------------------------------+
|                                                                    |
|  +-----------------+  +------------------+  +------------------+  |
|  |  Pair Manager   |  |  Scheduler       |  |  AI Agent        |  |
|  |  (per pair)     |  |  (cron/interval) |  |  (optional)      |  |
|  +-----------------+  +------------------+  +------------------+  |
|         |                      |                     |             |
|  +------v------+  +-----------v-----------+  +------v--------+   |
|  | Data Layer  |  |  Decision Engine      |  | Tx Executor   |   |
|  |             |  |                       |  |               |   |
|  | - GeckoAPI  |  | - Pool Utilization    |  | - viem client |   |
|  | - OHLC Feed |  | - Allocation Optim.   |  | - multicall   |   |
|  | - Fee Tier  |  | - Range Optimizer     |  | - BTR Swap    |   |
|  |   Reader    |  | - Rebalance Decision  |  | - EOA signer  |   |
|  +------+------+  +-----------+-----------+  +------+--------+   |
|         |                     |                      |             |
|  +------v---------------------v----------------------v--------+   |
|  |                    Pair State Store                         |   |
|  |  (SQLite: OHLC, snapshots, positions, tx history)          |   |
|  +------------------------------------------------------------+   |
|                                                                    |
+------------------------------------------------------------------+
         |                    |                       |
    GeckoTerminal       7 EVM Chains              BTR Swap
    REST API            (viem clients)            Aggregators
```

### 3.2 Core Components

```
src/
  index.ts              # CLI entrypoint
  scheduler.ts          # Interval loop per pair
  config/
    chains.ts           # Chain configs (RPC, chainId, native token)
    pairs.ts            # Pair configs (pools, EOA, thresholds, interval)
    dexs.ts             # DEX configs (router, factory, pool ABI variants)
    params.ts           # BTR force model default params
  data/
    gecko.ts            # GeckoTerminal API client (rate-limited)
    ohlc.ts             # OHLC feed (multi-source weighted, ccxt REST every interval)
    fees.ts             # On-chain fee tier reader (viem multicall)
    store.ts            # SQLite storage (OHLC, volume snapshots, positions)
  strategy/
    forces.ts           # Volatility, Momentum, Trend calculations
    range.ts            # BTR range optimizer (enhanced from front)
    utilization.ts      # Pool utilization / APR calculator
    allocation.ts       # Optimal pool allocation solver
    decision.ts         # RS/PRA/HOLD decision engine
  execution/
    positions.ts        # Read/write concentrated liquidity positions (viem)
    swap.ts             # Cross-chain + same-chain swap via BTR Swap SDK
    tx.ts               # Transaction builder + executor (EOA signer)
  agent/
    agent.ts            # AI agent wrapper (optional, for error recovery)
  types.ts              # Shared type definitions
  utils.ts              # Logging, math helpers
```

### 3.3 Tech Stack

| Component | Technology | Rationale |
|---|---|---|
| Runtime | Bun | Fast, native TS, minimal overhead |
| Chain interaction | viem | Native multicall, TypeScript-first, lighter than ethers |
| Swap execution | @btr-supply/swap | Existing BTR SDK, 15+ aggregators, cross-chain |
| Price data | ccxt (REST only) | Existing pattern from collector, multi-source weighted, 15min polls |
| Volume data | GeckoTerminal API | Only source of per-pool on-chain volume data |
| Storage | SQLite (bun:sqlite) | Zero-dependency, embedded, fast reads |
| AI agent | z.ai GLM-4.7 (OpenAI-compatible, optional) | Error recovery, complex tx sequencing |

### 3.4 Dependencies (Minimal)

```json
{
  "dependencies": {
    "viem": "^2.x",
    "ccxt": "^4.x",
    "@btr-supply/swap": "^1.44.x"
  },
  "devDependencies": {
    "@types/bun": "latest"
  }
}
```

SQLite via `bun:sqlite` (built-in, zero-dep). No HTTP library needed (Bun native fetch). No cron library (simple `setInterval`).

---

## 4. Detailed Design

### 4.1 Data Layer

#### 4.1.1 GeckoTerminal Client (`data/gecko.ts`)

```
Rate limit: 30 req/min, exponential backoff on 429, random delay 100-500ms
Endpoint: GET /api/p1/pools/{network}/{pool_address}
  -> { volume_24h, reserve_in_usd (TVL) }

Per-pair snapshot stored every interval:
  { pool_address, chain, timestamp, volume_24h, tvl }

Interval volume = snapshot[t].volume_24h - snapshot[t-1].volume_24h
  if < 0: fallback to snapshot[t].volume_24h / (86400 / interval_seconds)
```

**Pool-specific endpoint** (preferred over search): `GET /api/v2/networks/{network}/pools/{address}` returns pool attributes including `volume_usd` (24h) and `reserve_in_usd` (TVL).

#### 4.1.2 OHLC Feed (`data/ohlc.ts`)

Adapted from the collector pattern (REST-only, no WebSockets):
- Every interval: fetch latest OHLC candles via `ccxt.fetchOHLCV()` REST from multiple exchanges
- Weighted aggregation across sources (same pattern as collector config)
- M15 candles stored in SQLite, higher TFs reconstructed on-demand
- 1 month rolling window (configurable)
- Historical backfill on startup via REST `fetchOHLCV` with pagination
- Used by the force model for range optimization

Since we only need data every 15 minutes, REST polling is simpler and more reliable than maintaining WebSocket connections. Each cycle fetches the latest M15 candle from each source, computes the weighted average, and appends to the store.

#### 4.1.3 Fee Tier Reader (`data/fees.ts`)

On-chain fee tier read via viem multicall every interval:

```typescript
// UniV3-style: pool.fee() -> uint24 (eg. 500 = 0.05%)
// Algebra-style: pool.globalState() -> { fee } (dynamic, eg. 100 = 0.01%)
// CakeV3: pool.fee() same as UniV3
// TraderJoe LB: binStep based fee calculation
```

We read both old and new fee tiers and use the mean: `fee = (fee_prev + fee_new) / 2` for interval estimation.

### 4.2 Strategy Layer

#### 4.2.1 Pool Utilization Calculator (`strategy/utilization.ts`)

```
For each pool in the pair config:
  interval_volume = gecko_volume_diff(pool, interval)
  fee_tier = mean(fee_prev, fee_new)  // on-chain read
  fees_generated = interval_volume * fee_tier
  tvl = gecko_tvl(pool)
  utilization = fees_generated / tvl  // per-interval yield
  apr = utilization * (365 * 24 * 3600 / interval_seconds)
```

#### 4.2.2 Allocation Optimizer (`strategy/allocation.ts`)

The core optimization problem: given N pools with utilization curves (decreasing function of TVL since we add liquidity), allocate capital L across up to K pools (default 3) to maximize total APR.

**Model**: For pool i with current TVL_i and our deposit d_i:
```
  apr_i(d_i) = (interval_volume_i * fee_i) / (tvl_i + d_i) * annualization_factor
```

This is a concave optimization (sum of hyperbolas) solvable via:
1. Sort pools by marginal APR (volume * fee / tvl^2) descending
2. Greedy allocation: deposit into highest marginal APR pool until it equals the next
3. Equalize marginal APRs across selected pools (water-filling algorithm)
4. Cap at K pools

**Output**: `{ pool_address, chain, allocation_pct, expected_apr }[]`

#### 4.2.3 Range Optimizer (`strategy/range.ts`)

Enhanced BTR force model operating on M15 OHLC data (1 month rolling window):

**Multi-timeframe analysis**:
```
  M15 forces:  v15, m15, t15  (lookback: 96 candles = 24h)
  H1 forces:   v1h, m1h, t1h  (lookback: 168 candles = 7d)
  H4 forces:   v4h, m4h, t4h  (lookback: 180 candles = 30d)

  Composite force (weighted):
    vforce = 0.5*v15 + 0.3*v1h + 0.2*v4h
    mforce = 0.5*m15 + 0.3*m1h + 0.2*t1h
    tforce = 0.4*t15 + 0.35*t1h + 0.25*t4h
```

**Range optimization** (improvement over naive front implementation):
- Instead of fixed params, **optimize for maximum in-range time** given historical data
- Backtest candidate ranges against last 7 days of M15 data
- Score = `in_range_ratio / breadth` (narrower ranges that still capture most price action win)
- Apply BTR force model as the initial candidate generator, then hill-climb

**Tick alignment**: Convert price ranges to tick-aligned values per DEX tick spacing.

#### 4.2.4 Decision Engine (`strategy/decision.ts`)

Two independent triggers evaluated every interval:

**1. Pool Re-Allocation (PRA)** - Threshold-based:
```
  new_optimal_apr = allocation_optimizer(current_capital)
  current_apr = weighted_avg(current_positions_apr)
  improvement = (new_optimal_apr - current_apr) / current_apr

  if improvement > pra_threshold (default 5%):
    -> PRA: liquidate all positions, redistribute to new optimal pools
    -> Also re-enter with new optimal ranges (since we liquidated anyway)
```

**2. Range-Shift (RS)** - Divergence-based:
```
  for each current position:
    new_range = range_optimizer(pool, current_price)
    divergence = range_divergence(current_range, new_range)

    if divergence > rs_threshold (default 25%):
      -> RS: liquidate position in this pool, re-enter with new range
      -> Stay in same pool (no pool change)
```

**Priority**: PRA > RS (if PRA triggers, RS is subsumed since we liquidate anyway)

**HOLD**: If neither PRA nor RS triggers, do nothing.

### 4.3 Execution Layer

#### 4.3.1 Position Manager (`execution/positions.ts`)

Per-DEX position management via viem:

**UniV3-style pools** (UniV3, CakeV3, Aero, Velo, Ramses, etc.):
```typescript
// Read position: NonfungiblePositionManager.positions(tokenId)
// Mint: NonfungiblePositionManager.mint({ token0, token1, fee, tickLower, tickUpper, amount0Desired, amount1Desired, ... })
// Burn: NonfungiblePositionManager.decreaseLiquidity(tokenId, liquidity, ...)
// Collect: NonfungiblePositionManager.collect(tokenId, ...)
```

**Algebra-style pools** (QuickSwap, Camelot, Thena):
```typescript
// Similar but uses AlgebraPositionManager with dynamic fees
```

**LB pools** (TraderJoe, Merchant Moe):
```typescript
// Different interface: addLiquidity with binIds instead of ticks
```

Each DEX variant gets a thin adapter implementing a common interface:
```typescript
interface IDEXPositionManager {
  getPosition(positionId: string): Promise<Position>
  mint(pool: PoolConfig, tickLower: number, tickUpper: number, amount0: bigint, amount1: bigint): Promise<TxHash>
  burn(positionId: string): Promise<TxHash>
  collect(positionId: string): Promise<TxHash>
}
```

#### 4.3.2 Swap Executor (`execution/swap.ts`)

Uses `@btr-supply/swap` SDK:

**Same-chain swap** (rebalancing token ratios for a new range):
```typescript
const tx = await btrSwap.getTransactionRequest({
  input: { chainId, address: token0, decimals, ... },
  output: { chainId, address: token1, decimals, ... },
  inputAmountWei: amountToSwap,
  payer: eoaAddress,
})
```

**Cross-chain transfer** (moving capital between chains for PRA):
```typescript
// Use meta-aggregators (LiFi, Socket, Squid) for bridge+swap
const tx = await btrSwap.getTransactionRequest({
  input: { chainId: srcChain, address: token, ... },
  output: { chainId: dstChain, address: token, ... },
  inputAmountWei: amount,
  payer: eoaAddress,
})
```

#### 4.3.3 Transaction Builder (`execution/tx.ts`)

Sequential execution with confirmation tracking:

```
PRA Flow:
  1. For each current position (parallel per chain):
     a. Burn position (decreaseLiquidity + collect)
     b. Wait for confirmation
  2. If cross-chain needed:
     a. Bridge tokens via BTR Swap
     b. Wait for bridge completion (poll status)
  3. For each new position (parallel per chain):
     a. Swap to required token ratio if needed
     b. Mint new position
     c. Wait for confirmation
  4. Record new positions in state store

RS Flow (simpler, same-chain only):
  1. Burn position in target pool
  2. Swap to required token ratio for new range
  3. Mint new position with new ticks
  4. Record updated position
```

### 4.4 AI Agent Assessment

**Where AI adds most value vs. pure procedural scripts:**

| Area | Procedural | AI Agent | Verdict |
|---|---|---|---|
| Data fetching (GeckoTerminal, OHLC) | Straightforward API calls | No benefit | **Procedural** |
| Utilization/APR calculation | Pure math | No benefit | **Procedural** |
| Allocation optimization | Deterministic solver | No benefit | **Procedural** |
| Range optimization | Deterministic (force model) | Could explore novel ranges | **Procedural** (force model is good enough) |
| Rebalance decision | Threshold comparison | No benefit | **Procedural** |
| Same-chain tx execution | Deterministic sequence | No benefit | **Procedural** |
| Cross-chain tx execution | Complex: bridge delays, status polling, partial failures | **High value**: can reason about failures, retry strategies, alternative routes | **AI Agent** |
| Error recovery | Hard to enumerate all failure modes | **High value**: can diagnose unexpected states, choose recovery actions | **AI Agent** |
| Gas optimization | Can estimate, but hard to time | **Medium value**: can reason about gas price trends, batch timing | **Procedural** (with gas price thresholds) |
| Emergency situations | Predefined circuit breakers | **High value**: can detect anomalies (price manipulation, bridge exploit) and take protective action | **AI Agent** |

**Recommendation**: The core loop (data->strategy->decision) should be **fully procedural** for speed and determinism. The AI agent wraps only the **execution layer** as a supervisor:

1. **Normal flow**: Procedural scripts execute the decided transactions
2. **On failure**: AI agent is invoked to diagnose and recover:
   - Failed transaction: analyze revert reason, adjust gas/slippage, retry
   - Bridge stuck: check status, escalate, try alternative route
   - Unexpected state: EOA balance mismatch, orphaned position, etc.
3. **Anomaly detection**: AI reviews execution results for sanity (slippage too high, unexpected token balances)

This keeps the hot path fast (no LLM latency in the 15-min loop) while leveraging AI for the long tail of edge cases that are hard to automate.

### 4.5 State Management

SQLite database per pair (or shared with pair-scoped tables):

```sql
-- Volume snapshots for interval calculation
CREATE TABLE volume_snapshots (
  pool_address TEXT,
  chain TEXT,
  timestamp INTEGER,
  volume_24h REAL,
  tvl REAL,
  fee_tier REAL,
  PRIMARY KEY (pool_address, chain, timestamp)
);

-- OHLC candles (M1 base, higher TFs reconstructed)
CREATE TABLE ohlc (
  pair TEXT,
  timestamp INTEGER,
  open REAL, high REAL, low REAL, close REAL, volume REAL,
  PRIMARY KEY (pair, timestamp)
);

-- Current positions
CREATE TABLE positions (
  id TEXT PRIMARY KEY,
  pair TEXT,
  pool_address TEXT,
  chain TEXT,
  dex TEXT,
  position_id TEXT,  -- NFT tokenId or LB position ID
  tick_lower INTEGER,
  tick_upper INTEGER,
  liquidity TEXT,     -- bigint as string
  amount0 TEXT,
  amount1 TEXT,
  entry_price REAL,
  entry_timestamp INTEGER,
  entry_apr REAL
);

-- Transaction history
CREATE TABLE transactions (
  tx_hash TEXT PRIMARY KEY,
  pair TEXT,
  chain TEXT,
  type TEXT,  -- 'mint', 'burn', 'collect', 'swap', 'bridge'
  timestamp INTEGER,
  gas_used TEXT,
  gas_price TEXT,
  status TEXT
);

-- Decision log
CREATE TABLE decisions (
  timestamp INTEGER PRIMARY KEY,
  pair TEXT,
  type TEXT,  -- 'PRA', 'RS', 'HOLD'
  current_apr REAL,
  new_optimal_apr REAL,
  improvement REAL,
  details TEXT  -- JSON blob
);
```

---

## 5. Pair Configuration

```typescript
interface PairConfig {
  id: string                    // e.g., "USDC-USDT"
  token0: TokenConfig           // { symbol, decimals, addresses: Record<chain, address> }
  token1: TokenConfig
  eoa: {
    address: string             // Same address on all chains (CREATE2 or manual)
    privateKeyEnvVar: string    // e.g., "USDC_USDT_PK"
  }
  pools: PoolConfig[]           // All tracked pools across chains
  interval: number              // Seconds between cycles (default 900 = 15min)
  maxPools: number              // Max simultaneous positions (default 3)
  thresholds: {
    pra: number                 // Pool re-allocation APR improvement threshold (default 0.05 = 5%)
    rs: number                  // Range-shift divergence threshold (default 0.25 = 25%)
  }
  forceParams: IBtrParams       // Override force model params per pair
}

interface PoolConfig {
  address: string               // Pool contract address
  chain: ChainId                // e.g., "ethereum", "base", "arbitrum"
  dex: DEXSlug                  // e.g., "uniswap_v3", "pancakeswap_v3", "aerodrome_v3"
  geckoNetwork: string          // GeckoTerminal network slug (e.g., "eth", "base")
  geckoPoolAddress: string      // May differ from contract address
}
```

---

## 6. Execution Flow (One Cycle)

```
[t=0] Scheduler fires for pair "USDC-USDT"
  |
  |-- [1] DATA FETCH (parallel)
  |   |-- GeckoTerminal: fetch volume_24h + TVL for all pools
  |   |-- On-chain: read fee tiers for all pools (viem multicall, batched per chain)
  |   |-- OHLC: fetch latest M15 candle via ccxt REST (multi-source weighted)
  |   '-- Store snapshots in SQLite
  |
  |-- [2] COMPUTE (sequential)
  |   |-- Calculate interval volume per pool (diff from previous snapshot)
  |   |-- Calculate utilization/APR per pool (with mean fee tier)
  |   |-- Run allocation optimizer -> optimal {pool, allocation%}[]
  |   |-- Calculate optimal APR with new allocation
  |   |-- Run force model on M15 OHLC -> vforce, mforce, tforce
  |   |-- Run range optimizer -> optimal {tickLower, tickUpper} per pool
  |   '-- Calculate current positions APR
  |
  |-- [3] DECIDE
  |   |-- Compare new_optimal_apr vs current_apr -> PRA?
  |   |-- Compare new_ranges vs current_ranges -> RS?
  |   |-- Log decision
  |   '-- If HOLD -> done, wait for next interval
  |
  '-- [4] EXECUTE (if PRA or RS)
      |-- [PRA] Full rebalance:
      |   |-- Burn all positions (parallel per chain)
      |   |-- Bridge/transfer tokens if cross-chain reallocation needed
      |   |-- Swap to required ratios per pool
      |   '-- Mint new positions with optimal ranges
      |
      '-- [RS] Range shift (per affected pool):
          |-- Burn position in pool
          |-- Swap to required ratio for new range
          '-- Mint new position with new ticks
```

---

## 7. Chains & Target DEXes

| Chain | ChainId | GeckoTerminal ID | Target DEXes |
|---|---|---|---|
| Ethereum | 1 | eth | Uniswap V3 |
| BNB Chain | 56 | bsc | PancakeSwap V3, Thena V3 |
| Base | 8453 | base | Aerodrome V3, Uniswap V3 |
| Arbitrum | 42161 | arbitrum | Uniswap V3, Camelot V3, Ramses V3 |
| HyperEVM | 999 | hyperevm | HyperSwap (TBD), KittenSwap (TBD) |
| Avalanche | 43114 | avax | Trader Joe LB, Uniswap V3 |
| Polygon | 137 | polygon_pos | QuickSwap V3, Uniswap V3 |

---

## 8. Risk Controls

- **Gas price ceiling**: Skip execution if gas price > threshold (configurable per chain)
- **Slippage cap**: Max 0.5% for stable pairs, 2% for volatile pairs (passed to BTR Swap)
- **Min position value**: Don't create positions below $1000 (gas costs dominate)
- **Bridge timeout**: Max 30 min wait for cross-chain transfers, fallback to alternative route
- **Circuit breaker**: If 3 consecutive execution failures, pause pair and alert
- **Max rebalance frequency**: Even if threshold met, min 2 intervals between rebalances
- **Sanity checks**: Post-execution balance verification, position existence confirmation

---

## 9. Task Breakdown

### Phase 1: Foundation
1. [ ] Project scaffolding (Bun, tsconfig, package.json, directory structure)
2. [ ] Type definitions (pairs, pools, chains, positions, forces)
3. [ ] Chain configuration (RPC endpoints, chainIds, block explorers)
4. [ ] SQLite storage layer (schema, CRUD operations)
5. [ ] Logging utility

### Phase 2: Data Layer
6. [ ] GeckoTerminal API client (rate-limited, with snapshot diffing)
7. [ ] On-chain fee tier reader (viem multicall, per-DEX ABI)
8. [ ] OHLC feed (ccxt REST multi-source weighted, M15 polling each interval)
9. [ ] Historical data backfill (1 month of M15 candles on startup via ccxt REST)

### Phase 3: Strategy Layer
10. [ ] Force calculations (volatility, momentum, trend) - port from front
11. [ ] Multi-timeframe force composite (M15 + H1 + H4)
12. [ ] Range optimizer (BTR force model + historical backtest scoring)
13. [ ] Pool utilization / APR calculator
14. [ ] Allocation optimizer (water-filling algorithm)
15. [ ] Decision engine (PRA/RS/HOLD logic)

### Phase 4: Execution Layer
16. [ ] DEX position adapters (UniV3, CakeV3, Algebra, Aero/Velo, LB)
17. [ ] Position reader (current positions, ticks, liquidity, fees accrued)
18. [ ] BTR Swap integration (same-chain swap, cross-chain bridge)
19. [ ] Transaction builder + executor (sequential with confirmations)
20. [ ] Post-execution verification

### Phase 5: Orchestration
21. [ ] Pair manager (lifecycle: init, cycle, shutdown)
22. [ ] Scheduler (interval loop, parallel pairs)
23. [ ] CLI interface (start, stop, status, force-rebalance, show-positions)
24. [ ] Configuration loader (YAML/JSON pair configs)

### Phase 6: AI Agent (Optional)
25. [ ] AI agent wrapper for execution supervision
26. [ ] Error recovery strategies (revert diagnosis, retry with adjusted params)
27. [ ] Anomaly detection (post-execution sanity checks)

### Phase 7: Testing & Hardening
28. [ ] Unit tests (force model, allocation optimizer, decision engine)
29. [ ] Integration tests (GeckoTerminal client, on-chain reads)
30. [ ] Dry-run mode (full cycle without executing transactions)
31. [ ] Mainnet testing with small capital

---

## 10. Open Questions for Confirmation

1. **HyperEVM DEXes**: Which specific DEXes on HyperEVM should we support? Need pool addresses and ABI confirmation.
2. **Initial pair list**: Starting with USDC/USDT only, or multiple pairs from day 1?
3. **EOA provisioning**: Will you provide the EOA private keys, or should the system generate them?
4. **Capital per pair**: Approximate starting capital per pair (affects allocation optimizer sensitivity)?
5. ~~**AI provider**~~: **Resolved** - z.ai GLM-4.7 (OpenAI-compatible chat endpoint)
6. **Alerting**: Discord/Telegram notifications for rebalances and errors, or CLI-only for now?
7. **BTR Swap cross-chain confidence**: Has the SDK been tested for automated cross-chain execution (bridge completion polling, etc.), or does this need development?
