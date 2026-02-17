# Range Optimizer

*Reviewed by 6 independent agents across 2 rounds (quant, compute, risk, simplification, architecture). Consensus: the original CMA-ES proposal was over-engineered. This document reflects the simplified design.*

## 1. Problem Statement

The current system uses static `DEFAULT_FORCE_PARAMS` and a single indicator per force (coefficient of variation for volatility, RSI for momentum, SMA crossover for trend). The main weakness is not "static parameters" — it's that the volatility estimator uses only close prices when OHLC data is available, wasting ~80% of the available price information (Parkinson 1980).

**Goal**: Upgrade the volatility estimator, make range width adapt to market conditions, and optimize the core tradeoff — range tightness (fee concentration) vs rebalancing cost (LVR) — with minimum complexity.

## 2. Execution Context — PRA & RS Triggers

The optimizer produces better inputs (forces -> ranges -> allocations) that feed into the existing two-trigger system:

### Pool Re-Allocation (PRA)
```
improvement = (optimalApr - currentApr) / currentApr
trigger if improvement > pra_threshold  (default 5%)
```

### Range Shift (RS)
```
divergence = rangeDivergence(currentRange, targetRange)
trigger if divergence > rs_threshold  (default 25%, bounds [0.10, 0.35])
```

**Minimum holding period**: After any RS or PRA execution, suppress RS triggers for 4 epochs (1 hour). Prevents pathological rebalance-every-epoch behavior.

### Range Divergence Formula
```
sizeDiff   = |currentWidth - targetWidth| / currentWidth
centerDiff = |currentCenter - targetCenter| / currentWidth
divergence = min(sizeDiff + centerDiff, 1.0)
```

### Key Insight
Both PRA and RS are costly — gas, swap slippage, crystallized IL. The optimizer must internalize this: tight ranges yield higher gross APR but trigger more frequent RS, eroding net yield. The fitness function captures this tradeoff directly.

## 3. Fitness Function — Net Yield (APR - LVR)

### Definition
```
net_yield = gross_fee_APR - continuous_LVR - discrete_rebalancing_cost
```

### Gross Fee APR

Build on existing `utilization.ts` base APR with a concentration multiplier:
```
base_apr = (intervalVolume * feePct / tvl) * (seconds_per_year / intervalSec)

Per epoch, if price p in [pL, pH]:
  epoch_fee_apr = base_apr / (sqrt(pH) - sqrt(pL))
else:
  epoch_fee_apr = 0
```

Use the sqrt formula universally (no stablecoin approximation).

### Continuous LVR (Adverse Selection)

Per Milionis et al. (2022), LVR accrues continuously, proportional to sigma^2:
```
continuous_LVR_per_epoch = (sigma^2 / 2) * sqrt(p) / (sqrt(pH) - sqrt(pL)) * dt
```
Where `sigma` = Parkinson volatility, `dt` = epoch duration in years.

This is the dominant cost for concentrated positions. Without it, any optimizer systematically produces ranges that are too narrow.

### Discrete Rebalancing Cost

For each epoch where RS would trigger or price exits range:
```
rebalance_cost = gas_cost + swap_friction * position_value + fee_delay_cost

where:
  gas_cost       = p90_gas_price * 500_000 * native_token_price
  swap_friction  = (2 * pool_fee + base_slippage) * (1 + vforce / 100)
  fee_delay_cost = epoch_fee_income * 0.5
```

- **P90 gas price** — rebalancing correlates with volatility, which correlates with congestion
- **Volatility-scaled friction** — wider spreads during high-vol periods
- **Fee accrual delay** — 50% discount for first epoch post-mint

### Validation
```
Train on days 1-24, validate on days 25-30 (expanding window)
Accept only if validate_fitness >= 0.8 * train_fitness (reject if overfit)
Final fitness = validate_fitness (pure out-of-sample)
```

Single expanding-window validation is simpler and more appropriate for time series than k-fold CV — recency matters, and the most recent data is the best proxy for forward performance.

## 4. Why Not 23-Param CMA-ES

The original proposal used 23 free parameters (6 indicator blend + 12 MTF weights + 4 range params + 1 RS threshold) optimized via CMA-ES. Six independent reviewers identified critical problems:

### Indicator Blending Is Noise (6 params cut)

- CC, Parkinson, and Rogers-Satchell have **>0.90 pairwise correlation** on the same price series. Blending three collinear signals with 2 free params per force adds overfitting surface without marginal information.
- RSI and Stochastic %K correlation is >0.85. Same for MA-cross and LinReg slope.
- The correct approach: **pick the best single indicator per force offline** (Parkinson > CC is established science, not something to re-discover every 15 minutes).

### MTF Weight Optimization Is Waste (12 params cut)

- The optimal timeframe weighting is determined by the fundamental timescale of the LP decision (range width ~ hours to days), not by recent market conditions. This is structural, not epoch-variable.
- 12 parameters on ~40 effective independent observations (2,880 epochs with autocorrelation at lag-1 of ~0.99) is deep in overfitting territory (effective ratio ~1:3).
- Current fixed weights `[0.15, 0.2, 0.25, 0.25, 0.15]` already encode a reasonable prior.

### CMA-ES Is Disproportionate

- The optimizer (450 LOC) would be **larger than the entire strategy layer it optimizes** (555 LOC).
- Network I/O dominates the epoch budget (~42s for GeckoTerminal rate-limited fetches). The optimizer's 1-5s is 0.1-0.6% of epoch time — even a 10x slower approach is invisible.
- At 5 dimensions, Nelder-Mead converges reliably without eigendecomposition, covariance tracking, warm-start state, or any of the CMA-ES machinery.

## 5. Design — Incremental, Minimal

### Step 1: Upgrade Volatility Estimator (~15 LOC)

Replace CC (coefficient of variation) with **Parkinson volatility** in `vforce`. This is the single highest-value change — Parkinson uses H-L range data already available in `Candle.h` and `Candle.l`, is ~5x more statistically efficient, and requires zero architectural changes.

```
parkinson(candles, lookback) =
  sqrt(1 / (4 * n * ln2) * sum(ln(H_i / L_i)^2)) * normalization_factor
```

Drop-in replacement: force value stays 0-100, `baseRangeWidth` mapping unchanged. Everything downstream works identically with a better volatility signal.

**Expected impact**: Captures 30-50% of the total improvement the full optimizer would deliver, because the primary failure mode is underestimating volatility due to CC's statistical inefficiency.

### Step 2: Online Parameter Optimizer — Nelder-Mead on 5 Params (~80 LOC)

Optimize the 5 parameters that directly control the range width vs rebalancing cost tradeoff:

| Parameter | Bounds | Default | Role |
|-----------|--------|---------|------|
| `baseRange.min` | [0.0001, 0.005] | 0.0005 | Floor range width |
| `baseRange.max` | [0.005, 0.10] | 0.028 | Ceiling range width |
| `baseRange.vforceExp` | [-1.0, -0.05] | -0.4 | Volatility sensitivity curve |
| `baseRange.vforceDivider` | [50, 1000] | 300 | Volatility-to-range scaling |
| `rs_threshold` | [0.10, 0.35] | 0.25 | When to trigger range shift |

**Why these 5**: They directly control the only tradeoff that matters. Indicator choice and MTF weights are upstream signal processing that changes on timescales of weeks/months — optimize those offline. These 5 parameters respond to the current volatility regime and should adapt online.

**Nelder-Mead simplex** (not CMA-ES):
- No covariance matrix, no eigendecomposition, no population sampling
- Warm-start: initialize simplex from previous epoch's solution + small perturbations
- Converges in ~200-300 evaluations for 5D
- Wall time: ~200-300 evals x 2.5ms = **~0.5-0.8s**
- Implementation: ~60 LOC (vs ~250 for CMA-ES)

```
initialize:
  simplex = previous_solution + 5 perturbation vertices (or defaults on cold start)

repeat until converged or budget (300 evals):
  order vertices by fitness
  reflect worst vertex through centroid
  if better than best: expand
  elif worse than second-worst: contract
  else: accept reflection

  if all vertices within tolerance: converged

return best vertex if fitness > default_fitness, else defaults
```

### Step 3: Offline Sweep Tool — CLI Command (~40 LOC)

`bun run tune` — grid search on the 5 params against 90 days of historical data. Outputs recommended `DEFAULT_FORCE_PARAMS` overrides. Run monthly to update baseline defaults.

This captures the long-horizon parameter drift that the online optimizer is too short-sighted to detect (30-day window vs 90-day sweep).

## 6. Indicators — One Per Force, Best Available

| Force | Current | Upgrade | Rationale |
|-------|---------|---------|-----------|
| **Volatility** | CC (std/mean) | **Parkinson** | 5x more statistically efficient. Uses H-L data already available. Drift-agnostic for crypto. |
| **Momentum** | RSI | **RSI** (keep) | Proven, robust. Stochastic/CCI have >0.80 correlation with RSI — blending adds no info. |
| **Trend** | MA-cross | **MA-cross** (keep) | Stable, low false-signal rate. LinReg is lower lag but noisier. Determine best choice via offline backtest if desired. |

**No indicator blending.** If a one-time offline backtest shows Rogers-Satchell or LinReg slope is consistently better, swap the indicator. Don't blend.

## 7. MTF — Fixed Weights, 3 Timeframes

Drop M1 and M5. Sub-15-min signals are microstructure noise that provides negative alpha after transaction costs for an LP making 15-min range decisions.

| Frame | Lookback | Weight (all forces) |
|-------|----------|---------------------|
| M15 | 96 (24h) | 0.30 |
| H1 | 168 (7d) | 0.40 |
| H4 | 180 (30d) | 0.30 |

Fixed weights, determined offline. Not optimized per-epoch.

## 8. Regime Detection (Circuit Breaker)

Before the optimizer runs, check for abnormal conditions:

| Condition | Formula | Action |
|-----------|---------|--------|
| **Volatility spike** | trailing 1h Parkinson vol > 30d mean + 3 sigma | Max-width ranges, skip optimizer for 4 epochs |
| **Price displacement** | \|price_now - price_1h_ago\| / price > 2% (stables) or 10% (volatile) | Max-width ranges, skip optimizer for 4 epochs |
| **Volume anomaly** | current epoch volume > 5x 30d mean | Widen ranges by 50% |

## 9. Operational Safeguards

### Kill-Switches

| Trigger | Condition | Action |
|---------|-----------|--------|
| Negative yield | Trailing 6h net yield < 0 | Revert to defaults for 24h |
| Excessive RS | RS triggers > 8 in trailing 4h | Revert to defaults, flag for review |
| Pathological range | Range breadth < 0.001 (0.1%) | Reject, use defaults |
| Gas budget exceeded | Trailing 24h gas spend > 5% of position value | Halt all rebalancing |

### Fallback Guard

If the optimized solution's fitness on the validation window is worse than `DEFAULT_FORCE_PARAMS`, discard and use defaults. The optimizer provably cannot make things worse.

## 10. Integration

### Scheduler Cycle

```
scheduler.ts cycle():
  0. REGIME CHECK: circuit breaker                          (NEW — ~0.1ms)
  1. RAW DATA:     fetch candles + snapshots                (existing — ~42s)
  2. OPTIMIZE:     nelder_mead(candles, prev_solution)      (NEW — ~0.5s)
  3. COMPUTE:      forces(candles, optimized_params)        (existing)
  4. ANALYZE:      pool analyses + water-fill allocation    (existing)
  5. DECIDE:       PRA / RS / HOLD                          (existing, uses optimized rs_threshold)
  6. EXECUTE:      burn / swap / mint                       (existing)
```

### New Files

| File | Purpose | ~LOC |
|------|---------|------|
| `src/strategy/indicators.ts` | Parkinson volatility estimator | ~20 |
| `src/strategy/optimizer.ts` | Nelder-Mead + fitness function + regime detection | ~100 |

### Modified Files

| File | Change |
|------|--------|
| `src/strategy/forces.ts` | `vforce` calls `parkinson()` instead of `std/mean*100` |
| `src/config/params.ts` | Add rs_threshold to defaults |
| `src/scheduler.ts` | Call regime check + optimizer before force computation |
| `src/types.ts` | Add rs_threshold to ForceParams |

### State

Nelder-Mead simplex (5 vertices x 5 params = 25 floats) persisted in memory. On restart, cold-start from defaults. No covariance matrix, no eigendecomposition, no staleness checks needed.

## 11. Speed Budget

```
Regime check:                              ~0.1ms
Pre-computation (Parkinson on 3 TFs):      ~3ms
Nelder-Mead (300 evals x 2.5ms/eval):     ~750ms
Total optimizer wall time:                  ~750ms

Epoch budget: 900s (15 min)
Network I/O (GeckoTerminal + CEX):         ~42-48s
Optimizer fraction of epoch:               ~0.08%
```

## 12. Complexity Comparison

| Aspect | Original Proposal | Simplified Design |
|--------|-------------------|-------------------|
| Search space | 23 params | **5 params** |
| Optimizer | Active CMA-ES (eigendecomp, covariance, CSA, evolution paths) | **Nelder-Mead simplex** |
| Indicators | 9 (3 per force, blended via softmax) | **3 (1 per force, Parkinson upgraded)** |
| Timeframes | 5 (M1-H4, optimized weights) | **3 (M15, H1, H4, fixed weights)** |
| New LOC | ~450 | **~120** |
| Runtime state | Mean + sigma + 23x23 covariance matrix | **5x6 simplex (25 floats)** |
| Warm-start complexity | Sigma inflation, covariance staleness, cold-start suppression | **Start from previous best vertex** |
| Maintenance burden | ~4-16 hrs/month debugging | **Near zero** |
| Expected net yield improvement | 25-75 bps (unquantified) | **20-60 bps** (80% of full proposal) |

## 13. Risk Matrix

| # | Risk | Likelihood | Impact | Severity | Mitigation |
|---|------|-----------|--------|----------|------------|
| 1 | Regime change, stale params | HIGH | HIGH | **CRITICAL** | Regime detector circuit breaker |
| 2 | Overfitting (5 params on 30d) | LOW | MEDIUM | **LOW** | Expanding-window validation + fallback guard + only 5 params |
| 3 | RS threshold at bound | LOW | MEDIUM | **LOW** | Tight bounds [0.10, 0.35] + minimum holding period |
| 4 | Gas spike during rebalancing | MEDIUM | MEDIUM | **MEDIUM** | P90 gas in fitness, gas budget kill-switch |
| 5 | Nelder-Mead non-convergence | LOW | LOW | **LOW** | Falls back to defaults (no convergence = use what works) |

### Worst-Case Capital-at-Risk

With safeguards (regime detection + kill-switches): regime detector suspends optimization within 1 epoch. Maximum exposure = 1 rebalance at crisis pricing. **1.5-4% of position value.**

## 14. Escalation Path

If the simplified optimizer proves insufficient (measured via 90-day backtest, not hypothesized):

1. **Add Rogers-Satchell** alongside Parkinson (single offline backtest to pick better one). ~10 LOC.
2. **Add 2nd optimizer dimension** for momentum indicator choice (RSI vs KAMA ER). Still Nelder-Mead, 6-7 params.
3. **Only if Steps 1-2 prove value**: consider CMA-ES for a 10-15 param space with indicator blending. Not before.

Every escalation step must demonstrate statistically significant OOS improvement over the simpler version.

## 15. Summary

| Aspect | Detail |
|--------|--------|
| **What** | Nelder-Mead optimizer on 5 range parameters + Parkinson volatility upgrade |
| **Objective** | Maximize net yield = gross fee APR - continuous LVR (sigma^2) - discrete rebalancing cost |
| **Speed** | ~750ms per epoch (<0.1% of budget) |
| **Overfitting** | 5 params, expanding-window validation, fallback guard |
| **Safety** | Regime detector + kill-switches + minimum holding period |
| **Complexity** | ~120 LOC across 2 new files |
| **Risk** | Falls back to static defaults if optimizer underperforms |

### References

- Milionis, J., Moallemi, C., Roughgarden, T. & Zhang, A. (2022). Automated Market Making and Loss-Versus-Rebalancing.
- Parkinson, M. (1980). The Extreme Value Method for Estimating the Variance of the Rate of Return.
- Nelder, J. & Mead, R. (1965). A Simplex Method for Function Minimization.
- Bergstra, J. & Bengio, Y. (2012). Random Search for Hyper-Parameter Optimization.
