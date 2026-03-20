<script lang="ts">
  import { refreshConfig } from "../lib/stores.svelte";
  import { onMount } from "svelte";
  import ConfigStrategyEditor from "./ConfigStrategyEditor.svelte";
  import ConfigDexEditor from "./ConfigDexEditor.svelte";
  import ConfigPoolEditor from "./ConfigPoolEditor.svelte";
  import ConfigRpcEditor from "./ConfigRpcEditor.svelte";

  let tab = $state<"strategies" | "dexs" | "pools" | "rpcs">("strategies");

  const tabs: { id: typeof tab; label: string }[] = [
    { id: "strategies", label: "Strategies" },
    { id: "dexs", label: "DEXs" },
    { id: "pools", label: "Pools" },
    { id: "rpcs", label: "RPCs" },
  ];

  onMount(() => { refreshConfig(); });
</script>

<div class="space-y-0">
  <nav class="flex border-b border-zinc-800">
    {#each tabs as t}
      <button
        class="tab"
        data-active={tab === t.id || undefined}
        onclick={() => tab = t.id}
      >{t.label}</button>
    {/each}
  </nav>

  {#if tab === "strategies"}
    <ConfigStrategyEditor />
  {:else if tab === "dexs"}
    <ConfigDexEditor />
  {:else if tab === "pools"}
    <ConfigPoolEditor />
  {:else}
    <ConfigRpcEditor />
  {/if}
</div>
