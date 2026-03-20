<script lang="ts">
  import { PaneGroup, Pane, PaneResizer } from "paneforge";
  import { app, setCandleRange } from "../lib/stores.svelte";
  import { fmtPct, fmtTime } from "@btr-supply/shared/format";
  import PriceChart from "./PriceChart.svelte";
  import ForceChart from "./ForceChart.svelte";
  import SecondaryChart from "./SecondaryChart.svelte";
  import AllocationChart from "./AllocationChart.svelte";
  import DivergenceChart from "./DivergenceChart.svelte";
  import BottomTables from "./BottomTables.svelte";

  const ranges: [string, number][] = [
    ["1h", 3600_000],
    ["6h", 6 * 3600_000],
    ["24h", 24 * 3600_000],
    ["7d", 7 * 24 * 3600_000],
    ["30d", 30 * 24 * 3600_000],
  ];

  const strategyName = $derived(app.selectedStrategy || app.status?.id || "");
  const pairId = $derived((app.status as any)?.pairId ?? app.status?.id ?? "");
  const currentApr = $derived(app.allocation?.currentApr ?? (app.status as any)?.currentApr ?? 0);
  const optimalApr = $derived(app.allocation?.optimalApr ?? (app.status as any)?.optimalApr ?? 0);
  const improvement = $derived(app.allocation?.improvement ?? (optimalApr > 0 ? optimalApr - currentApr : 0));
  const hasApr = $derived(currentApr > 0 || optimalApr > 0);
</script>

{#if app.status}
  <div class="flex items-center justify-between px-2 py-1 shrink-0">
    <div class="flex items-center gap-2">
      <span class="text-sm font-semibold text-zinc-200">{strategyName}</span>
      {#if pairId && pairId !== strategyName}
        <span class="text-xs text-zinc-600">{pairId}</span>
      {/if}
      <span class="decision-badge" data-decision={app.status.decision}>
        {app.status.decision}
      </span>
    </div>
    <div class="flex items-center gap-3 text-2xs text-zinc-600">
      {#if hasApr}
        <span>APR <span class="text-zinc-300">{fmtPct(currentApr)}</span></span>
        <span>Opt <span class="text-zinc-300">{fmtPct(optimalApr)}</span></span>
        {#if improvement > 0}
          <span class="text-positive">+{fmtPct(improvement)}</span>
        {/if}
      {/if}
      <span>E{app.status.epoch}</span>
      <span>{fmtTime(app.status.decisionTs)}</span>
    </div>
  </div>

  <PaneGroup direction="vertical" class="flex-1 overflow-hidden">
    <Pane class="relative overflow-hidden border-y border-zinc-800" minSize={15}>
      <div class="absolute top-1 right-2 z-10 flex gap-0.5 chart-overlay px-1 py-0.5">
        {#each ranges as [label, ms]}
          <button
            class="toggle"
            data-active={app.candleRange === ms || undefined}
            onclick={() => setCandleRange(ms)}>{label}</button>
        {/each}
      </div>
      <PriceChart
        candles={app.candles}
        positions={app.positions}
        txlog={app.txlog}
        optimalRanges={app.optimalRanges}
        rangeHistory={app.rangeHistory} />
    </Pane>
    <PaneResizer />
    <Pane class="overflow-hidden" minSize={8}>
      <ForceChart />
    </Pane>
    <PaneResizer />
    <Pane class="overflow-hidden" minSize={10}>
      <SecondaryChart />
    </Pane>
    <PaneResizer />
    <Pane class="overflow-hidden" minSize={8}>
      <AllocationChart />
    </Pane>
    <PaneResizer />
    <Pane class="overflow-hidden" minSize={8}>
      <DivergenceChart />
    </Pane>
    <PaneResizer />
    <Pane class="overflow-hidden" minSize={12}>
      <BottomTables />
    </Pane>
  </PaneGroup>
{:else}
  <div class="flex items-center justify-center h-64 text-xs text-zinc-600">
    Select a strategy
  </div>
{/if}
