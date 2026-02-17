# Range Computation

**Source**: `src/strategy/range.ts`

The range module converts the three force signals into a concrete price interval `[min, max]` for LP position placement. The output `Range` includes the interval bounds, confidence score, trend bias, and market type classification.

## From Forces to Range

### Step 1: Confidence Decay

Confidence starts at 100 and decays exponentially when volatility exceeds `criticalForce` (default 15):

$$C = 100 \cdot e^{\alpha_c \cdot (v - v_{\text{crit}})}$$

where $\alpha_c = -0.03$ (`confidence.vforceExp`) and $v_{\text{crit}} = 15$. High volatility reduces confidence, which in turn reduces trend bias magnitude -- the system becomes more symmetric (conservative) in uncertain conditions.

**Note**: this $\alpha_c$ is distinct from the base-range $\alpha_r$ in Step 3. Both are called `vforceExp` in config but serve different purposes: $\alpha_c = -0.03$ controls confidence decay, while $\alpha_r = -0.4$ controls range width.

### Step 2: Market Type Detection

The trend force classifies the market regime:

| tforce range | market type |
|-------------|-------------|
| < `bearishFrom` (40) | bearish |
| > `bullishFrom` (60) | bullish |
| 40-60 | neutral (ranging) |

In **ranging** markets, overbought/oversold momentum further reduces confidence (pre-breakout caution):

$$C \mathrel{/}= |m - 50| \cdot \beta_m$$

where $\beta_m = 5$ (`mforceDivider`).

In **trending** markets, trend-momentum agreement amplifies the bias:

Momentum backs trend:

$$b_t \mathrel{\times}= e^{\gamma \cdot |m - 50|}$$

Momentum opposes trend:

$$b_t \mathrel{/}= |m - 50| \cdot \delta, \qquad C \mathrel{/}= |m - 50| \cdot \beta_m$$

where $\gamma = 0.015$ (`biasExp`) and $\delta = 3$ (`biasDivider`).

### Step 3: Base Width from Volatility

The base range width (as a fraction of price) follows an exponential decay from `baseMax` to `baseMin`:

$$w = w_{\min} + (w_{\max} - w_{\min}) \cdot e^{\alpha_r \cdot v / D}$$

Default parameters: $w_{\min} = 0.0005$, $w_{\max} = 0.028$, $\alpha_r = -0.4$ (`baseRange.vforceExp`), $D = 300$ (`vforceDivider`).

Low volatility produces a narrow range (concentrate liquidity for maximum fees); high volatility widens the range (reduce impermanent loss risk).

### Step 4: Apply Trend Bias

The base width is split asymmetrically based on trend bias $b_t$. Let $a = 1 + |b_t|$:

$$r_{\min}, r_{\max} = \begin{cases} W / a,\; W \cdot a & \text{if } b_t > 0 \text{ (bullish)} \\ W \cdot a,\; W / a & \text{if } b_t < 0 \text{ (bearish)} \\ W,\; W & \text{if } b_t = 0 \text{ (neutral)} \end{cases}$$

where $W = P \cdot w$ is the absolute base width. A bullish bias places more range above the current price; bearish below.

### Step 5: Output

```typescript
interface Range {
  min: number;       // lower price bound
  max: number;       // upper price bound
  base: number;      // current price
  breadth: number;   // (max - min) / base
  confidence: number; // 0-100
  trendBias: number; // negative = bearish, positive = bullish
  type: "bullish" | "bearish" | "neutral";
}
```

## Range Divergence

Measures how far a current position's range has drifted from the target:

$$d_{\text{size}} = \frac{|R_c - R_t|}{R_c}, \qquad d_{\text{center}} = \frac{|\bar{c}_c - \bar{c}_t|}{R_c}$$

$$\text{divergence} = \min(d_{\text{size}} + d_{\text{center}},\ 1)$$

where $R_c$, $R_t$ are the current and target range widths, and $\bar{c}_c$, $\bar{c}_t$ their midpoints. When $\text{divergence} > \theta_{\text{RS}}$ (default 0.25), a Range Shift is triggered.

## Tick Alignment

Ranges must align to the pool's `tickSpacing`. The `rangeToTicks` function converts price bounds to aligned ticks:

```typescript
tickLower = alignTick(priceToTick(range.min), tickSpacing, "down");
tickUpper = alignTick(priceToTick(range.max), tickSpacing, "up");
```

Where `priceToTick(p) = log(p) / log(1.0001)`. Rounding ensures the lower tick rounds down and the upper tick rounds up, so the actual range is always at least as wide as the computed range.

## See Also

- [3-Force Model](forces.md) -- how the input forces are computed
- [Range Optimizer](optimizer.md) -- online tuning of `baseMin`, `baseMax`, `vforceExp`, `vforceDivider`
- [Decision Engine](decision.md) -- how range divergence triggers RS
- [DEX Position Adapters](../execution/positions.md) -- tick-aligned ranges are passed to mint operations
- [Glossary](../glossary.md) -- rangeDivergence, trendBias, confidence
