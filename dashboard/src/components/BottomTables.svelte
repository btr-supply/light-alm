<script lang="ts">
  import TabBar from "./TabBar.svelte";
  import ExposureTable from "./ExposureTable.svelte";
  import TxLog from "./TxLog.svelte";

  const tabs = ["Exposure", "Tx Log"];
  let active = $state("Exposure");
</script>

<div class="flex flex-col h-full overflow-hidden border-t border-zinc-800">
  <TabBar {tabs} {active} onchange={(t) => active = t} />
  <div class="flex-1 overflow-y-auto">
    {#if active === "Exposure"}
      <ExposureTable />
    {:else}
      <TxLog />
    {/if}
  </div>
</div>
