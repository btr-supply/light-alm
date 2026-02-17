# Glossary

## Decision Types

| Term | Definition |
|------|-----------|
| **PRA** | Pool Re-Allocation. Burn all positions and redistribute capital across pools based on the water-fill optimizer. Triggered when `improvement > pra_threshold` (default 5%). |
| **RS** | Range Shift. Adjust one or more positions whose tick range has diverged from the target. Triggered when `rangeDivergence > rs_threshold` (default 25%). |
| **HOLD** | Do nothing. Current positions are within acceptable parameters. |

## Force Model

| Term | Definition |
|------|-----------|
| **mforce** | Momentum force (0-100). RSI(14) on closes plus directional day count. 50 = neutral, >60 = overbought, <40 = oversold. See [forces](strategy/forces.md). |
| **MTF** | Multi-timeframe. Forces are computed at M15 (30%), H1 (40%), H4 (30%) and blended by weight. |
| **OHLC** | Open-High-Low-Close candlestick data. M1 candles are the base timeframe, aggregated to M15/H1/H4 for the force model. |
| **Parkinson volatility** | Range-based volatility estimator: $\sigma_P = \sqrt{\sum \ln(H/L)^2 / (4N \ln 2)}$. Approximately 5x more efficient than close-to-close (Parkinson 1980). See [forces](strategy/forces.md). |
| **RSI** | Relative Strength Index. Wilder-smoothed momentum oscillator (period 14). Values: 0-100, with >70 overbought and <30 oversold. |
| **SMA** | Simple Moving Average. Arithmetic mean of the last $n$ closing prices. Used for trend detection in the tforce calculation. |
| **tforce** | Trend force (0-100). Short/long SMA crossover normalized to 50-center scale. >60 = bullish, <40 = bearish. See [forces](strategy/forces.md). |
| **vforce** | Volatility force (0-100). Parkinson estimator on OHLC high-low range, converted via sigmoid: $100 \cdot (1 - e^{-60\sigma})$. Higher values mean wider ranges. See [forces](strategy/forces.md). |

## Range & Optimization

| Term | Definition |
|------|-----------|
| **BPS** | Basis points. 1 BPS = 0.01% = 0.0001. Used for slippage (default 50 BPS) and fee tiers. |
| **confidence** | 0-100 score reflecting certainty in the range estimate. Decays exponentially with volatility above `criticalForce`. See [range computation](strategy/range.md). |
| **fitness function** | Net yield metric maximized by the optimizer: $\text{fitness} = \overline{\text{APR}}_{\text{fee}} - \text{LVR} - \text{rebalancing cost}$. See [optimizer](strategy/optimizer.md). |
| **IL** | Impermanent Loss. Portfolio value loss compared to holding the same tokens outside an AMM position. |
| **kill switch** | Safety mechanism: >8 RS in 4h, negative trailing yields, or gas budget >5% of position value triggers reversion to default parameters. See [optimizer](strategy/optimizer.md). |
| **LVR** | Loss-Versus-Rebalancing (Milionis et al. 2022). Modeled as $(\sigma^2 / 2) \cdot \sqrt{P} / (\sqrt{p_H} - \sqrt{p_L}) \cdot \Delta t$ per epoch. See [optimizer](strategy/optimizer.md). |
| **Nelder-Mead** | Derivative-free simplex optimizer. Tunes 5 range parameters online. Budget: 300 evaluations per epoch (~750ms). |
| **overfitting guard** | Validation fitness must be at least 80% of training fitness; otherwise the parameter set is rejected. |
| **rangeBreadth** | `(max - min) / base_price`. Total range width as a fraction of the current price. |
| **rangeDivergence** | $\min(d_{\text{size}} + d_{\text{center}},\, 1)$ where $d_{\text{size}} = |R_c - R_t| / R_c$ and $d_{\text{center}} = |\bar{c}_c - \bar{c}_t| / R_c$. See [range computation](strategy/range.md). |
| **regime detection** | Circuit breaker that suppresses the optimizer during abnormal conditions: volatility spike (>3-sigma), price displacement (>2% stables, >10% volatile), volume anomaly (>5x mean). |
| **trendBias** | Asymmetry factor for range placement. Positive = wider upside, negative = wider downside. Scaled by trend/momentum agreement. |

## AMM Mechanics

| Term | Definition |
|------|-----------|
| **sqrtPriceX96** | Uniswap V3 price encoding: `sqrt(price) * 2^96` stored as a uint160. |
| **tick** | Discrete price point in V3/V4: `price = 1.0001^tick`. Positions are defined by `[tickLower, tickUpper]`. |
| **tickSpacing** | Minimum tick increment for a pool. Determined by fee tier (e.g., 10 for 0.05%, 60 for 0.30%). |
| **liquidity** | V3 sqrt-liquidity (L): the geometric relationship between token amounts in a concentrated position. `L = sqrt(x * y)` within the active range. |
| **CLMM** | Concentrated Liquidity Market Maker. Umbrella term for V3/V4/Algebra/Aerodrome AMMs. |
| **binStep** | Trader Joe LB bin width in basis points. Each bin is a discrete price interval. |
| **activeId** | Currently active bin in a Trader Joe LB pool. Analogous to the current tick in V3. |
| **PoolKey** | V4 pool identifier: `(currency0, currency1, fee, tickSpacing, hooks)`. Used to reconstruct pool reference at mint time. |

## DEX Families

| Term | Definition |
|------|-----------|
| **V3** | Standard Uniswap V3 interface (NonfungiblePositionManager). Used by Uni V3, PCS V3, Pharaoh, Ramses, Pangolin, Project X. |
| **Algebra** | Algebra Integral protocol (dynamic fees, `globalState` instead of `slot0`). Used by Blackhole V3, Camelot V3, QuickSwap V3. |
| **Aerodrome** | Aerodrome V3 on Base. V3-compatible with minor ABI differences. |
| **V4** | Uniswap V4 / PancakeSwap V4. Action-encoded operations (mint=0x02, burn=0x03). Pool IDs are bytes32. |
| **LB** | Trader Joe Liquidity Book. ERC-1155 bin tokens, `positionId` format: `lb:<lowerBin>:<upperBin>`. |

## Data Sources

| Term | Definition |
|------|-----------|
| **ccxt** | Unified CEX API library. Used for M1 OHLC candles from Binance, Bybit, OKX, MEXC, Gate, Bitget. See [OHLC](data/ohlc.md). |
| **GeckoTerminal** | REST API for on-chain pool data: TVL, 24h volume, fee tier, token prices. Rate limited at 2s between calls. See [GeckoTerminal](data/gecko.md). |
| **interval volume** | Difference of two consecutive GeckoTerminal 24h volume snapshots. Falls back to `volume_24h / 96` when the diff is negative. See [GeckoTerminal](data/gecko.md). |
| **Li.Fi / Jumper** | Cross-chain swap and bridge aggregator API. Used for token swaps and cross-chain bridging. See [swap](execution/swap.md). |
| **Permit2** | Canonical Uniswap approval contract (`0x000...22D473`). Used for gasless token approvals with expiry. See [transactions](execution/transactions.md). |

## Execution & Orchestration

| Term | Definition |
|------|-----------|
| **cross-chain rebalancing** | Moving token balances across chains via Li.Fi/Jumper bridge aggregators. Triggered during PRA when the target allocation spans multiple chains. See [swap](execution/swap.md). |
| **epoch snapshot** | Per-cycle summary metrics (PnL, positions, rebalance count, regime) ingested to OpenObserve for trailing analysis. See [observability](infrastructure/observability.md). |
| **gas buffer** | 120% multiplier on `eth_estimateGas` to prevent out-of-gas reverts from state changes between estimation and mining. See [transactions](execution/transactions.md). |
| **regime suppression** | Circuit breaker disabling the optimizer for 4 epochs after detecting volatility spikes, price displacement, or volume anomalies. See [optimizer](strategy/optimizer.md). |
| **slippage** | Price difference between expected and actual execution. Default tolerance: 50 BPS (0.5%). Applied to `amount0Min`/`amount1Min` in mints and swaps. See [transactions](execution/transactions.md). |
| **token ratio rebalancing** | Adjusting per-chain token0/token1 balances toward the target ratio (typically 50/50) via same-chain swaps before minting. See [swap](execution/swap.md). |
| **warm-start** | Reusing the previous epoch's best optimizer vector as the initial simplex point. Persisted in DragonflyDB. See [optimizer](strategy/optimizer.md). |
| **water-fill** | Concave allocation optimizer equalizing marginal APR across pools via bisection. See [allocation](strategy/allocation.md). |

## Infrastructure

| Term | Definition |
|------|-----------|
| **APR** | Annualized Percentage Rate. Computed as $(V_{24h} \cdot f) / \text{TVL} \times 365.25$. |
| **DragonflyDB** | Redis-compatible in-memory store. Used for orchestrator lock, worker locks, heartbeats, worker state pub/sub. See [orchestrator](infrastructure/orchestrator.md). |
| **epoch** | One scheduler cycle (15 minutes = 900 seconds). 96 epochs per day. |
| **OpenObserve** | Log and metrics platform. Receives buffered JSON payloads (flush every 5s, buffer size 100). See [observability](infrastructure/observability.md). |
| **TVL** | Total Value Locked in a pool (USD-denominated via GeckoTerminal). |

## See Also

- [System Overview](overview.md) -- high-level system description
- [3-Force Model](strategy/forces.md) -- force computation details
- [Range Optimizer](strategy/optimizer.md) -- Nelder-Mead and regime detection
- [Architecture](architecture.md) -- module map and tech stack
