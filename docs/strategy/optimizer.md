# Range Optimizer

**Source**: `src/strategy/optimizer.ts`

The optimizer tunes 5 range parameters online using Nelder-Mead simplex search, maximizing net yield (fee income minus LVR and rebalancing costs). It runs every epoch (15 min) and converges in up to 300 evaluations.

## Optimized Parameters

| Parameter | Bounds | Default | Role |
|-----------|--------|---------|------|
| `baseMin` | [0.0001, 0.005] | 0.0005 | Minimum range width (fraction of price) |
| `baseMax` | [0.005, 0.1] | 0.028 | Maximum range width |
| `vforceExp` | [-1.0, -0.05] | -0.4 | Volatility-to-width decay rate |
| `vforceDivider` | [50, 1000] | 300 | Volatility scaling denominator |
| `rsThreshold` | [0.10, 0.35] | 0.25 | Range divergence threshold for RS |

## Fitness Function

The optimizer maximizes **net yield** over a historical simulation window:

$$\text{fitness} = \overline{\text{APR}}_{\text{fee}} - \text{LVR}_{\text{annual}} - \text{Cost}_{\text{annual}}$$

### Fee APR

Earned only when the simulated price is within the active position range. Uses the pool's base APR directly (no concentration multiplier -- the base APR already represents marginal LP return).

### Continuous LVR (Milionis et al. 2022)

Per-epoch LVR accumulation when price $P$ is in range $[p_L, p_H]$:

$$\text{LVR}_{\text{epoch}} = \frac{\sigma^2}{2} \cdot \frac{\sqrt{P}}{\sqrt{p_H} - \sqrt{p_L}} \cdot \Delta t$$

where $\sigma$ is the Parkinson volatility and $\Delta t$ is the epoch duration in years ($900 / 31{,}557{,}600$). This captures the fundamental cost of providing liquidity: the AMM continuously sells the appreciating asset, crystallizing loss versus a holding strategy.

**Continuous-only LVR accounting**: the optimizer uses only the continuous LVR formula (Milionis et al.). Discrete LVR at range shift events (HODL value minus LP value) is a subset of the continuous accumulation, so it is **not** subtracted separately to avoid double-counting.

### Rebalancing Cost

At each simulated range shift:

$$\text{Cost}_{\text{RS}} = G + \left(2f + s\right) \cdot \left(1 + \frac{v}{100}\right) \cdot V$$

where $G$ is gas cost (USD), $f$ the pool fee, $s = 0.001$ (10bps swap friction, `FITNESS_SWAP_FRICTION`), $v$ the current vforce, and $V$ the position value. The vforce multiplier accounts for wider spreads during volatile periods.

### Minimum RS Gap

Range shifts in the simulation are throttled to at least **4 epochs** apart (`FITNESS_MIN_RS_GAP = 4`). This prevents the optimizer from rewarding hyper-frequent rebalancing that would be dominated by gas costs in practice.

## Train / Validation Split

The candle window is split with a **static 80/20 ratio** (`FITNESS_TRAIN_SPLIT = 0.8`):

- **Train**: first 80% of candles -- used for Nelder-Mead search
- **Validation**: last 20% -- overfit guard

Rejection rule: if `val_fitness < 0.8 * train_fitness` (`FITNESS_OVERFIT_RATIO`), the parameter set is rejected (returns $-\infty$).

## Nelder-Mead Simplex

Standard Nelder-Mead with clamped bounds:

| Coefficient | Value |
|-------------|-------|
| Alpha (reflection) | 1.0 |
| Gamma (expansion) | 2.0 |
| Rho (contraction) | 0.5 |
| Sigma (shrink) | 0.5 |
| Max evaluations | 300 |
| Convergence tolerance | 1e-8 |

The initial simplex is built from the warm-start point (previous epoch's best solution or defaults) with alternating +/- perturbations to avoid degeneracy near bounds.

**Fallback guard**: if the optimizer's best fitness is worse than the default parameter fitness, defaults are used.

## Warm-Start

The best parameter vector is cached per pair ID (`Map<string, number[]>`) and persisted to DragonflyDB. On worker restart, the warm-start is loaded:

```typescript
const saved = await store.getOptimizerState();
if (saved) setWarmStart(pair.id, saved.vec);
```

## Regime Detection (Circuit Breaker)

Before running the optimizer, a regime check can suppress it for up to 4 epochs (`REGIME_SUPPRESS_EPOCHS`):

| Trigger | Condition | Effect |
|---------|-----------|--------|
| Volatility spike | 1h Parkinson vol > mean + 3*sigma (30d hourly samples) | Suppress optimizer for 4 epochs |
| Price displacement | 1h price move > 2% (stables) or > 10% (volatile) | Suppress optimizer for 4 epochs |
| Volume anomaly | Epoch volume > 5x average epoch volume | **Widen range by 1.5x** (no suppression) |

When suppressed, the system forces HOLD decisions (no PRA/RS execution). The volume anomaly regime does **not** suppress -- it widens the range by `REGIME_WIDEN_FACTOR = 1.5` to accommodate increased volatility while continuing normal operation.

## Kill-Switches

Post-optimization safety checks that revert to default parameters:

| Kill-switch | Condition |
|-------------|-----------|
| Negative yield | Trailing 6h (24 epochs) mean net yield < 0 |
| Excessive RS | > 8 range shifts in trailing 4h window |
| Pathological range | `baseMax - baseMin < 0.001` |
| Gas budget | Trailing 24h gas cost > 5% of position value |

## References

- Milionis, J. et al. (2022). "Automated Market Making and Loss-Versus-Rebalancing."
- Parkinson, M. (1980). "The Extreme Value Method for Estimating the Variance of the Rate of Return."

## See Also

- [3-Force Model](forces.md) -- the signals that feed the fitness simulation
- [Range Computation](range.md) -- how optimized parameters control range width
- [Decision Engine](decision.md) -- how `rsThreshold` from the optimizer affects RS decisions
- [DragonflyDB Store](../data/store-dragonfly.md) -- optimizer warm-start persistence
- [Glossary](../glossary.md) -- LVR, Nelder-Mead, regime detection definitions
