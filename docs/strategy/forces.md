# 3-Force Model

**Source**: `src/strategy/forces.ts`, `src/strategy/indicators.ts`

The force model produces three signals on a 0-100 scale that drive every downstream decision: range width, range placement, confidence, and ultimately PRA/RS/HOLD.

## Volatility Force (vforce)

Measures recent price dispersion using the Parkinson (1980) range-based estimator on OHLC high-low data:

$$\sigma_P = \sqrt{\frac{1}{4N \ln 2} \sum_{i=1}^{N} \left(\ln \frac{H_i}{L_i}\right)^2}$$

This is approximately **5x more statistically efficient** than close-to-close standard deviation because it captures intra-bar price action.

The raw sigma is mapped to a 0-100 scale via sigmoid:

$$\text{vforce} = 100 \cdot \left(1 - e^{-k \cdot \sigma_P}\right)$$

where $k = 60$ (`VFORCE_SIGMOID_SCALE`).

The scale factor (60) is calibrated for M15 candle periods:

| sigma | vforce | regime |
|-------|--------|--------|
| 0.002 | ~11 | typical stable pair |
| 0.01 | ~45 | typical volatile pair |
| 0.03 | ~83 | crisis / black swan |

**Fallback**: when H-L data is unavailable (missing candle fields), falls back to coefficient of variation: $\text{vforce} = (\sigma / \mu) \times 100$.

```typescript
// src/strategy/indicators.ts
export function parkinsonVforce(candles: Candle[], lookback: number): number {
  const sigma = parkinsonVolatility(candles, lookback);
  return cap(100 * (1 - Math.exp(-VFORCE_SIGMOID_SCALE * sigma)), 0, 100);
}
```

## Momentum Force (mforce)

RSI-based signal measuring buying/selling pressure. Wilder's smoothed RSI (period $n = 14$):

$$\text{RSI} = 100 - \frac{100}{1 + \dfrac{\overline{U}_n}{\overline{D}_n}}$$

where $\overline{U}_n$ and $\overline{D}_n$ are Wilder-smoothed average gains and losses:

$$\overline{U}_i = \frac{(n-1) \cdot \overline{U}_{i-1} + U_i}{n}, \qquad \overline{D}_i = \frac{(n-1) \cdot \overline{D}_{i-1} + D_i}{n}$$

The mforce output is $\text{mforce} = \text{clamp}(\text{RSI}, 0, 100)$.

| mforce | interpretation |
|--------|---------------|
| < 40 | oversold |
| 40-60 | neutral |
| > 60 | overbought |

RSI period is fixed at 14. The directional count (`up`/`down`) is informational and used for trend-momentum agreement checks in range computation.

## Trend Force (tforce)

Short/long SMA crossover, normalized to a 50-centered scale:

$$p_s = \lfloor L / 3 \rfloor, \quad p_l = \lfloor 2L / 3 \rfloor$$

$$\text{tforce} = \text{clamp}\!\left(50 + \frac{\text{SMA}_{p_s} - \text{SMA}_{p_l}}{\text{SMA}_{p_l}} \times S,\ 0,\ 100\right)$$

where $L$ is the lookback and $S = 1000$ (`TREND_SCALE`) amplifies small MA divergences into the 0-100 range.

| tforce | interpretation |
|--------|---------------|
| < 40 | bearish trend |
| 40-60 | neutral / ranging |
| > 60 | bullish trend |

## Multi-Timeframe Composite

M1 candles are aggregated into three timeframes, each independently producing a full `Forces` triple. The composites are blended by fixed weights:

| Timeframe | Candle count | Weight $w_i$ |
|-----------|-------------|--------------|
| M15 | 96 (24h) | 0.30 |
| H1 | 168 (7d) | 0.40 |
| H4 | 180 (30d) | 0.30 |

For each force component $f \in \{v, m, t\}$:

$$f_{\text{composite}} = \sum_{i \in \{\text{M15}, \text{H1}, \text{H4}\}} w_i \cdot f_i$$

M1 and M5 timeframes were deliberately dropped -- sub-15-minute signals are microstructure noise for LP position decisions.

Aggregation is done from M1 source candles using absolute period boundaries to avoid compounding rounding errors.

## Default Parameters

```typescript
{
  volatility: { lookback: 24, criticalForce: 15 },
  momentum:   { lookback: 24, oversoldFrom: 40, overboughtFrom: 60 },
  trend:      { lookback: 36, bullishFrom: 60, bearishFrom: 40,
                biasExp: 0.015, biasDivider: 3 },
}
```

The `criticalForce` (15) is the volatility threshold below which confidence remains at maximum. Above it, confidence decays exponentially.

## See Also

- [Range Computation](range.md) -- how forces drive range width and placement
- [Range Optimizer](optimizer.md) -- online tuning of range parameters
- [Multi-Source OHLC](../data/ohlc.md) -- M1 candle data source for force computation
- [Glossary](../glossary.md) -- vforce, mforce, tforce definitions
- [System Overview](../overview.md) -- where forces fit in the pipeline
