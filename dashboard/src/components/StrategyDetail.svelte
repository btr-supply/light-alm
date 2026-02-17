<script lang="ts">
  import { app, setCandleRange } from "../lib/stores.svelte";
  import PriceChart from "./PriceChart.svelte";
  import PnlSummary from "./PnlSummary.svelte";
  import Allocations from "./Allocations.svelte";
  import Forces from "./Forces.svelte";
  import Stat from "./Stat.svelte";
  import { fmtPct, fmtTime } from "@btr-supply/shared/format";
  import { DECISION, CARD, TEXT, SMALL } from "../lib/theme";

  const ranges: [string, number][] = [
    ["1h", 3600_000],
    ["6h", 6 * 3600_000],
    ["24h", 24 * 3600_000],
  ];
</script>

{#if app.status}
  <div class="flex items-center justify-between">
    <h2 class="text-lg font-bold">{app.status.id}</h2>
    <div class="flex items-center gap-3 text-xs">
      <span class="px-2 py-0.5 rounded {DECISION[app.status.decision]?.badge ?? 'bg-zinc-900/50 ' + TEXT.secondary}">
        {app.status.decision}
      </span>
      <span class={TEXT.label}>epoch {app.status.epoch}</span>
      <span class={TEXT.label}>{fmtTime(app.status.decisionTs)}</span>
    </div>
  </div>

  {#if app.allocation?.ts}
    <div class="flex gap-4 text-xs">
      <Stat label="Current APR" value={fmtPct(app.allocation.currentApr)} />
      <Stat label="Optimal APR" value={fmtPct(app.allocation.optimalApr)} />
      <Stat label="Improvement" value={fmtPct(app.allocation.improvement)}
        cls={app.allocation.improvement > 0 ? TEXT.positive : TEXT.secondary} />
    </div>
  {/if}

  <div class="{CARD} p-2">
    <div class="flex justify-end gap-1 mb-1">
      {#each ranges as [label, ms]}
        <button
          class="{SMALL} px-1.5 py-0.5 rounded {app.candleRange === ms ? 'bg-zinc-700 ' + TEXT.primary : TEXT.label + ' hover:text-zinc-300'}"
          onclick={() => setCandleRange(ms)}>{label}</button>
      {/each}
    </div>
    <PriceChart candles={app.candles} positions={app.positions} txlog={app.txlog} />
  </div>

  <PnlSummary />
  <Allocations />
  <Forces />
{:else}
  <div class="flex items-center justify-center h-64 {TEXT.dim} text-sm">
    Select a pair to view details
  </div>
{/if}
