<script lang="ts">
  import { onMount } from "svelte";
  import { app, startPolling, stopPolling } from "./lib/stores.svelte";
  import { loadDocs, buildSearchIndex } from "./lib/docs";
  import PairList from "./components/PairList.svelte";
  import StrategyDetail from "./components/StrategyDetail.svelte";
  import AdvancedStats from "./components/AdvancedStats.svelte";
  import AlertBanner from "./components/AlertBanner.svelte";
  import DocsView from "./components/DocsView.svelte";
  import SearchDialog from "./components/SearchDialog.svelte";
  import { LAYOUT, TEXT } from "./lib/theme";

  let showSidebar = $state(true);
  let view = $state<"dashboard" | "docs">("dashboard");

  const pages = loadDocs();
  const searchIndex = buildSearchIndex(pages);
  let docsViewRef = $state<DocsView>();
  let searchDialogRef = $state<SearchDialog>();

  function handleSearchSelect(id: string) {
    view = "docs";
    queueMicrotask(() => docsViewRef?.navigate(id));
  }

  onMount(() => {
    startPolling(30_000);
    return stopPolling;
  });
</script>

<SearchDialog bind:this={searchDialogRef} {searchIndex} onSelect={handleSearchSelect} />

<div class="flex h-screen overflow-hidden">
  {#if view === "dashboard"}
    <aside class="{LAYOUT.sidebarW} shrink-0 border-r border-zinc-800 overflow-y-auto
      max-md:absolute max-md:z-10 max-md:h-full max-md:bg-zinc-950
      {showSidebar ? '' : 'max-md:hidden'}">
      <div class="p-3 border-b border-zinc-800 flex items-center justify-between">
        <h1 class="text-sm font-bold tracking-wider {TEXT.value}">BTR ALM</h1>
        <div class="flex items-center gap-2">
          <button class="text-[10px] {TEXT.label} hover:text-zinc-300 transition-colors"
            onclick={() => view = "docs"}>Docs</button>
          <button class="md:hidden {TEXT.label} text-xs" onclick={() => showSidebar = false}>&times;</button>
        </div>
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
  {:else}
    <div class="flex-1 flex flex-col">
      <div class="p-3 border-b border-zinc-800 flex items-center justify-between shrink-0">
        <div class="flex items-center gap-3">
          <button class="text-xs {TEXT.label} hover:text-zinc-300 transition-colors"
            onclick={() => view = "dashboard"}>&larr; Dashboard</button>
          <h1 class="text-sm font-bold tracking-wider {TEXT.value}">Documentation</h1>
        </div>
        <button class="text-[10px] {TEXT.dim} border border-zinc-700 rounded px-2 py-0.5"
          onclick={() => searchDialogRef?.open()}>
          Search <kbd class="ml-1">&#8984;K</kbd>
        </button>
      </div>
      <div class="flex-1 overflow-hidden">
        <DocsView bind:this={docsViewRef} />
      </div>
    </div>
  {/if}
</div>
