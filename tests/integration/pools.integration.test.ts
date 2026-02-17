import { describe, expect, test } from "bun:test";
import { POOL_REGISTRY } from "../../src/config/pools";
import { queryPool } from "../../src/adapters/pool-query";
import { getDexFamily } from "../../src/config/dexs";
import { resolveToken } from "../../src/config/tokens";
import { USDC, USDT } from "../../src/config/tokens";
import { DexFamily, type PoolEntry, type TokenConfig } from "../../src/types";

const pools = POOL_REGISTRY["USDC-USDT"];
const pairTokens: [TokenConfig, TokenConfig] = [USDC, USDT];

// Group pools by family for organized output
const byFamily = new Map<string, PoolEntry[]>();
for (const p of pools) {
  const f = getDexFamily(p.dex);
  const arr = byFamily.get(f) ?? [];
  arr.push(p);
  byFamily.set(f, arr);
}

for (const [family, entries] of byFamily) {
  describe(`${family} pools`, () => {
    for (const entry of entries) {
      const label = `${entry.dex} chain=${entry.chain} ${entry.id.slice(0, 12)}...`;

      test(label, async () => {
        const state = await queryPool(entry, pairTokens);

        // Universal fields — every pool type must return these
        expect(state.price).toBeGreaterThan(0);
        expect(state.fee).toBeGreaterThanOrEqual(0);
        expect(state.fee).toBeLessThan(0.05);

        if (family === DexFamily.LB) {
          // LB-specific: native bin fields, no CLMM fields
          expect(state.activeId).toBeDefined();
          expect(state.binStep).toBeDefined();
          expect(state.activeId!).toBeGreaterThan(0);
          expect(state.binStep!).toBeGreaterThan(0);
          expect(state.reserveX).toBeDefined();
          expect(state.reserveY).toBeDefined();
          // LB should NOT have CLMM fields
          expect(state.sqrtPriceX96).toBeUndefined();
          expect(state.tick).toBeUndefined();
          expect(state.liquidity).toBeUndefined();
          console.log(
            `  ${entry.dex} chain=${entry.chain} activeId=${state.activeId} binStep=${state.binStep} price=${state.price.toFixed(6)} fee=${(state.fee * 100).toFixed(4)}%`,
          );
        } else {
          // CLMM fields (V3/V4/Algebra/Aerodrome)
          expect(state.sqrtPriceX96).toBeDefined();
          expect(state.sqrtPriceX96!).toBeGreaterThan(0n);
          expect(state.tick).toBeDefined();
          expect(state.liquidity).toBeDefined();
          expect(state.liquidity!).toBeGreaterThan(0n);
          console.log(
            `  ${entry.dex} chain=${entry.chain} tick=${state.tick} price=${state.price.toFixed(6)} fee=${(state.fee * 100).toFixed(4)}% liq=${state.liquidity}`,
          );
        }

        // V3/algebra/aerodrome: verify token0/token1 are known USDC/USDT variants
        if (family !== DexFamily.V4 && family !== DexFamily.PCS_V4) {
          const t0 = resolveToken(state.token0, entry.chain);
          const t1 = resolveToken(state.token1, entry.chain);
          expect(t0).not.toBeNull();
          expect(t1).not.toBeNull();
        }
      }, 30_000);
    }
  });
}
