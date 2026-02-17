# Water-Fill Allocation

**Source**: `src/strategy/allocation.ts`

The allocation module distributes capital across multiple pools to maximize portfolio APR, accounting for TVL-based dilution. It uses a water-filling algorithm -- a concave optimization where, at equilibrium, marginal APRs across all selected pools are equal.

## Dilution Model

Each pool's marginal APR decreases as more capital is allocated to it:

$$\text{APR}_i(x_i) = \frac{A_i \cdot T_i}{T_i + x_i \cdot K}$$

where $A_i$ is the pool's base APR, $T_i$ its TVL, $x_i$ the allocation fraction, and $K$ the total capital (USD). This models the reality that adding capital to a pool dilutes fee income. A pool with $1M TVL and 50% APR becomes less attractive per marginal dollar than a pool with $10M TVL and 20% APR, depending on allocation size.

## Water-Fill Algorithm

The algorithm finds a "water level" $\lambda$ at which the sum of all allocations equals 100%.

**Equilibrium condition** -- marginal APRs are equal across all active pools:

$$\text{APR}_i(x_i) = \lambda \quad \forall\, i$$

Solving for $x_i$:

$$x_i = \max\!\left(\frac{A_i / \lambda - 1}{K / T_i},\ 0\right)$$

subject to the budget constraint $\sum_i x_i = 1$.

Binary search (bisection) finds $\lambda$ in the interval $[10^{-4},\ \max(A_i)]$. Convergence: tolerance $10^{-10}$ in at most 64 iterations.

## Constraints

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `maxPositions` | configurable per pair (default 3) | Cap on number of active pools |
| `ALLOC_MIN_PCT` | 0.001 (0.1%) | Minimum allocation to include a pool |
| `POSITION_VALUE_USD` | 10,000 | Default total capital for dilution calculation |

Pools are ranked by APR and only the top `maxPositions` with positive APR are considered. Allocations below 0.1% are dropped, and the remainder is normalized to sum to 100%.

## Output

```typescript
interface AllocationEntry {
  pool: `0x${string}`;     // pool address
  chain: ChainId;           // chain ID
  dex: DexId;              // DEX identifier
  pct: number;             // allocation fraction (0-1)
  expectedApr: number;     // post-dilution expected APR
}
```

The `expectedApr` reflects the diluted return after our capital is added:

$$\text{expectedApr}_i = \frac{A_i \cdot T_i}{T_i + x_i \cdot K}$$

## Portfolio APR

The weighted-average expected APR for the full allocation:

$$\text{APR}_{\text{portfolio}} = \sum_i x_i \cdot \text{expectedApr}_i$$

This value is compared against current APR in the [decision engine](decision.md) to determine whether a PRA is warranted.

## Example

Given three pools with APR and TVL:

| Pool | APR | TVL |
|------|-----|-----|
| A | 40% | $2M |
| B | 25% | $5M |
| C | 15% | $10M |

With $10k capital, the water-fill finds lambda where marginal APRs equalize. Pool A gets the largest share (highest marginal return) but its allocation is moderated by its smaller TVL (higher dilution sensitivity).

## See Also

- [Decision Engine](decision.md) -- how allocation APR drives PRA decisions
- [Range Optimizer](optimizer.md) -- fitness function uses similar APR modeling
- [GeckoTerminal Integration](../data/gecko.md) -- pool APR and TVL data source
- [Token Rebalancing](../execution/swap.md) -- cross-chain swaps to match target allocations
- [Architecture](../architecture.md) -- where allocation fits in the pipeline
- [Glossary](../glossary.md) -- APR, TVL, PRA definitions
