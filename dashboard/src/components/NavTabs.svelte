<script lang="ts">
  import { app, setView, type ViewType } from "../lib/stores.svelte";

  const tabs: { id: ViewType; label: string }[] = [
    { id: "dashboard", label: "Dashboard" },
    { id: "config", label: "Config" },
    { id: "docs", label: "Docs" },
  ];
</script>

<nav class="flex items-center">
  {#each tabs as tab}
    <button
      class="tab"
      data-active={app.view === tab.id || undefined}
      onclick={() => setView(tab.id)}
    >{tab.label}</button>
  {/each}
</nav>
