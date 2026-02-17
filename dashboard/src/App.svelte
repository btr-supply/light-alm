<script lang="ts">
  import { onMount } from "svelte";
  import { app, startPolling, stopPolling } from "./lib/stores.svelte";
  import PairList from "./components/PairList.svelte";
  import StrategyDetail from "./components/StrategyDetail.svelte";
  import AdvancedStats from "./components/AdvancedStats.svelte";
  import AlertBanner from "./components/AlertBanner.svelte";
  import { LAYOUT, TEXT } from "./lib/theme";

  let showSidebar = $state(true);

  onMount(() => {
    startPolling(30_000);
    return stopPolling;
  });
</script>

<div class="flex h-screen overflow-hidden">
  <aside class="{LAYOUT.sidebarW} shrink-0 border-r border-zinc-800 overflow-y-auto
    max-md:absolute max-md:z-10 max-md:h-full max-md:bg-zinc-950
    {showSidebar ? '' : 'max-md:hidden'}">
    <div class="p-3 border-b border-zinc-800 flex items-center justify-between">
      <h1 class="text-sm font-bold tracking-wider {TEXT.value}">BTR ALM</h1>
      <button class="md:hidden {TEXT.label} text-xs" onclick={() => showSidebar = false}>&times;</button>
    </div>
    <PairList />
  </aside>

  <main class="flex-1 overflow-y-auto p-4 space-y-4">
    <div class="flex items-center gap-2 md:hidden">
      <button class="{TEXT.label} text-xs border border-zinc-700 rounded px-2 py-1"
        onclick={() => showSidebar = !showSidebar}>Menu</button>
    </div>
    {#if app.loading}
      <div class="text-xs {TEXT.label} animate-pulse">Loading...</div>
    {/if}
    {#if app.error}
      <AlertBanner message={app.error} />
    {/if}
    <StrategyDetail />
  </main>

  <aside class="{LAYOUT.panelW} shrink-0 border-l border-zinc-800 overflow-y-auto max-md:hidden">
    <AdvancedStats />
  </aside>
</div>
