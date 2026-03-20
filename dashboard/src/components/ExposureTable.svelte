<script lang="ts">
  import { app } from "../lib/stores.svelte";
  import { fmtPct, fmtUsd, fmtTime, fmtNum, shortAddr, chainName, pairTokens as derivePairTokens } from "@btr-supply/shared/format";

  let groupBy = $state<"pool" | "token" | "chain">("pool");

  const positions = $derived(app.positions);

  const pairTokens = $derived(derivePairTokens((app.status as any)?.pairId ?? ""));

  // Chain-aggregated view
  const chainGroups = $derived.by(() => {
    const map = new Map<number, { chain: number; count: number; totalUsd: number }>();
    for (const p of positions) {
      const existing = map.get(p.chain);
      if (existing) { existing.count++; existing.totalUsd += p.entryValueUsd; }
      else map.set(p.chain, { chain: p.chain, count: 1, totalUsd: p.entryValueUsd });
    }
    return [...map.values()];
  });

  // Token-aggregated view: sum amount0 and amount1 across all positions
  const tokenAggregates = $derived.by(() => {
    let total0 = 0, total1 = 0;
    for (const p of positions) {
      total0 += parseFloat(p.amount0) || 0;
      total1 += parseFloat(p.amount1) || 0;
    }
    return [
      { token: pairTokens[0], amount: total0, positions: positions.length },
      { token: pairTokens[1], amount: total1, positions: positions.length },
    ];
  });
</script>

<div class="overflow-auto">
  <div class="flex items-center gap-2 px-2 py-1 border-b border-zinc-800/40">
    <span class="text-2xs text-zinc-500">Group:</span>
    {#each ["pool", "token", "chain"] as mode}
      <button class="toggle" data-active={groupBy === mode || undefined}
        onclick={() => groupBy = mode as any}>{mode}</button>
    {/each}
  </div>

  {#if groupBy === "pool"}
    <table class="tbl">
      <thead>
        <tr>
          <th class="th">Pool</th>
          <th class="th">Chain</th>
          <th class="th">DEX</th>
          <th class="th">Ticks</th>
          <th class="th">Liquidity</th>
          <th class="th">Entry APR</th>
          <th class="th">Entry Price</th>
          <th class="th">Entry Time</th>
          <th class="th text-right">Value USD</th>
        </tr>
      </thead>
      <tbody>
        {#each positions as pos}
          <tr class="tr">
            <td class="td">{shortAddr(pos.pool, 8, 0)}</td>
            <td class="td">{chainName(pos.chain)}</td>
            <td class="td">{pos.dex}</td>
            <td class="td">[{pos.tickLower}, {pos.tickUpper}]</td>
            <td class="td">{pos.liquidity ? shortAddr(pos.liquidity, 6, 0) : "-"}</td>
            <td class="td">{fmtPct(pos.entryApr, 1)}</td>
            <td class="td">{pos.entryPrice > 0 ? pos.entryPrice.toFixed(4) : "-"}</td>
            <td class="td">{pos.entryTs > 0 ? fmtTime(pos.entryTs) : "-"}</td>
            <td class="td text-right">{pos.entryValueUsd > 0 ? fmtUsd(pos.entryValueUsd) : "-"}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {:else if groupBy === "chain"}
    <table class="tbl">
      <thead>
        <tr>
          <th class="th">Chain</th>
          <th class="th">Positions</th>
          <th class="th text-right">Total USD</th>
        </tr>
      </thead>
      <tbody>
        {#each chainGroups as g}
          <tr class="tr">
            <td class="td">{chainName(g.chain)}</td>
            <td class="td">{g.count}</td>
            <td class="td text-right">{fmtUsd(g.totalUsd)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {:else}
    <!-- Token view: aggregated across all positions -->
    <table class="tbl">
      <thead>
        <tr>
          <th class="th">Token</th>
          <th class="th">Total Amount</th>
          <th class="th">Positions</th>
        </tr>
      </thead>
      <tbody>
        {#each tokenAggregates as agg}
          <tr class="tr">
            <td class="td font-medium">{agg.token}</td>
            <td class="td">{fmtNum(agg.amount, 4)}</td>
            <td class="td">{agg.positions}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}

  {#if positions.length === 0}
    <div class="text-center py-3 text-2xs text-zinc-600">No positions</div>
  {/if}
</div>
