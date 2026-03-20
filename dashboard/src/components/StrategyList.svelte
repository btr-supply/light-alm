<script lang="ts">
  import { app, selectStrategy } from "../lib/stores.svelte";
  import { fmtPct, fmtUsd, fmtDuration } from "@btr-supply/shared/format";
  import WorkerControls from "./WorkerControls.svelte";

  let totalTvl = $derived(app.strategies.reduce((s, st) => s + st.tvlUsd, 0));
  let avgApy = $derived(app.strategies.length > 0 ? app.strategies.reduce((s, st) => s + st.apy, 0) / app.strategies.length : 0);
  let totalPositions = $derived(app.strategies.reduce((s, st) => s + st.positions, 0));

  let allWorkers = $derived([
    ...(app.cluster?.collectors ?? []),
    ...(app.cluster?.strategies ?? []),
  ]);

</script>

<div class="flex flex-col h-full">
  <!-- Strategies section (top, flex-1) -->
  <div class="flex-1 overflow-y-auto">
    {#if app.strategies.length > 0}
      <div class="px-2 py-1.5 border-b border-zinc-800">
        <h4 class="section-header">Portfolio</h4>
        <div class="flex justify-between mt-1 text-2xs">
          <span class="text-zinc-500">{app.strategies.length} strat{app.strategies.length !== 1 ? "s" : ""}</span>
          <span class="text-zinc-500">{totalPositions} pos</span>
          <span class="text-zinc-500">avg {fmtPct(avgApy, 1)}</span>
        </div>
        {#if totalTvl > 0}
          <div class="text-xs text-zinc-300 mt-1">{fmtUsd(totalTvl)}</div>
        {/if}
      </div>
    {/if}

    {#each app.strategies as strat}
      <button
        class="list-item"
        data-active={app.selectedStrategy === strat.name || undefined}
        onclick={() => selectStrategy(strat.name)}
      >
        <div class="flex items-center justify-between">
          <div>
            <span class="font-medium">{strat.name}</span>
            {#if strat.pairId && strat.pairId !== strat.name}
              <span class="text-zinc-600 ml-1">{strat.pairId}</span>
            {/if}
          </div>
          <span class="status-dot" data-status={strat.status}></span>
        </div>
        <div class="flex justify-between mt-1 text-xs text-zinc-500">
          <span>APY {fmtPct(strat.apy, 1)}</span>
          <span>{strat.positions} pos</span>
          <span>E{strat.epoch}</span>
        </div>
      </button>
    {/each}

    {#if app.strategies.length === 0}
      <p class="empty-state text-center py-4">No strategies running</p>
    {/if}
  </div>

  <!-- Workers section (bottom, flex-1) -->
  <div class="flex-1 overflow-y-auto border-t border-zinc-800">
    <div class="px-2 py-1.5 border-b border-zinc-800/60">
      <h4 class="section-header">Workers</h4>
      {#if app.cluster}
        <span class="text-2xs text-zinc-600">{app.cluster.workers} total &middot; {Math.floor(app.cluster.uptime / 3600)}h up</span>
      {/if}
    </div>
    {#if allWorkers.length > 0}
      {#each allWorkers as worker}
        <div class="flex items-center gap-1.5 px-2 py-1 border-b border-zinc-800/30 text-2xs hover:bg-zinc-800/30">
          <span class="status-dot" data-status={worker.status}></span>
          <span class="truncate text-zinc-200 flex-1">{worker.id}</span>
          <span class="strategy-badge" data-status={worker.status}>{worker.workerType}</span>
          <span class="text-zinc-600">{fmtDuration(worker.uptimeMs)}</span>
          <WorkerControls {worker} compact />
        </div>
      {/each}
    {:else}
      <p class="empty-state text-center py-3">No workers</p>
    {/if}
  </div>
</div>
