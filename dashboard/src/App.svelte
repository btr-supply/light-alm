<script lang="ts">
  import { onMount } from "svelte";
  import { PaneGroup, Pane, PaneResizer } from "paneforge";
  import { app, startPolling, stopPolling, setView } from "./lib/stores.svelte";
  import Logo from "./components/Logo.svelte";
  import NavTabs from "./components/NavTabs.svelte";
  import AlertBanner from "./components/AlertBanner.svelte";
  import ConfigView from "./components/ConfigView.svelte";
  import DocsView from "./components/DocsView.svelte";
  import SearchDialog from "./components/SearchDialog.svelte";
  import StrategyList from "./components/StrategyList.svelte";
  import PaneStrategyDetail from "./components/PaneStrategyDetail.svelte";
  import StrategyPanel from "./components/StrategyPanel.svelte";

  let docsViewRef = $state<DocsView>();
  let searchDialogRef = $state<SearchDialog>();

  function handleSearchSelect(id: string) {
    setView("docs");
    queueMicrotask(() => docsViewRef?.navigate(id));
  }

  onMount(() => {
    startPolling(30_000);
    return stopPolling;
  });
</script>

<SearchDialog bind:this={searchDialogRef} onSelect={handleSearchSelect} />

<div class="flex flex-col h-screen overflow-hidden bg-zinc-950">
  <header class="flex items-center justify-between px-3 py-1.5 border-b border-zinc-800/80 shrink-0">
    <div class="flex items-center gap-3">
      <button class="flex items-center gap-1.5 hover:opacity-80 transition-opacity" onclick={() => setView("dashboard")}>
        <Logo size={18} />
        <span class="text-sm font-semibold tracking-wide text-zinc-300">ALM</span>
      </button>
      <div class="w-px h-4 bg-zinc-800"></div>
      <NavTabs />
    </div>
    <div class="flex items-center gap-2">
      {#if app.view === "docs"}
        <button class="btn-sm btn-ghost" onclick={() => searchDialogRef?.open()}>
          Search <kbd class="ml-1 opacity-50">&#8984;K</kbd>
        </button>
      {/if}
    </div>
  </header>

  {#if app.view === "dashboard"}
    <PaneGroup direction="horizontal" class="flex-1 overflow-hidden">
      <Pane class="h-full overflow-hidden bg-zinc-950 border-r border-zinc-800/60" minSize={15} defaultSize={20}>
        <StrategyList />
      </Pane>
      <PaneResizer />

      <Pane class="flex flex-col overflow-hidden bg-zinc-950" minSize={30}>
        {#if app.loading}
          <div class="text-2xs text-zinc-500 animate-pulse px-2 shrink-0">Loading...</div>
        {/if}
        {#if app.error}
          <div class="shrink-0"><AlertBanner message={app.error} /></div>
        {/if}
        <PaneStrategyDetail />
      </Pane>

      <PaneResizer />

      <Pane class="h-full overflow-hidden bg-zinc-950 border-l border-zinc-800/60" minSize={15} defaultSize={20}>
        <StrategyPanel />
      </Pane>
    </PaneGroup>

  {:else if app.view === "config"}
    <div class="flex-1 overflow-y-auto">
      <ConfigView />
    </div>

  {:else}
    <div class="flex-1 overflow-hidden">
      <DocsView bind:this={docsViewRef} />
    </div>
  {/if}
</div>
