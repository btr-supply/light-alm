<script lang="ts">
  import { app } from "../lib/stores.svelte";
  import { api } from "../lib/api";
  import { createCrud } from "../lib/crud.svelte";
  import type { StrategyConfigEntry } from "@btr-supply/shared/types";

  const crud = createCrud<StrategyConfigEntry>({
    save: (e) => api.saveConfigStrategy(e.name, e),
    remove: (e) => api.deleteConfigStrategy(e.name),
  });

  let editingName = $derived(crud.editing?.name ?? "");
</script>

<div>
  <div class="flex justify-between items-center px-2 py-1">
    <span class="text-2xs text-zinc-500">{app.configStrategies.length} strategies</span>
    <button class="btn-sm btn-primary"
      onclick={() => crud.startNew({ name: "", pairId: "USDC-USDT", pkEnvVar: "", pools: [], intervalSec: 900, maxPositions: 3, thresholds: { pra: 0.05, rs: 0.25 } })}>+ New</button>
  </div>

  {#if crud.opError}<div class="error-msg px-2">{crud.opError}</div>{/if}

  <table class="tbl">
    <thead>
      <tr>
        <th class="th">Name</th>
        <th class="th">Pair</th>
        <th class="th">PK Var</th>
        <th class="th">Intv</th>
        <th class="th">Max</th>
        <th class="th">Alloc%</th>
        <th class="th" style="width:4rem"></th>
      </tr>
    </thead>
    <tbody>
      {#if crud.editing && !app.configStrategies.some(e => e.name === editingName)}
        <tr class="tr">
          <td class="td"><input class="td-input" bind:value={crud.editing.name} placeholder="V1" /></td>
          <td class="td"><input class="td-input" bind:value={crud.editing.pairId} placeholder="USDC-USDT" /></td>
          <td class="td"><input class="td-input" bind:value={crud.editing.pkEnvVar} placeholder="V1_PK" /></td>
          <td class="td"><input class="td-input" type="number" bind:value={crud.editing.intervalSec} /></td>
          <td class="td"><input class="td-input" type="number" bind:value={crud.editing.maxPositions} /></td>
          <td class="td"><input class="td-input" type="number" step="0.01" bind:value={crud.editing.allocationPct} /></td>
          <td class="td flex gap-1">
            <button class="action-save" onclick={crud.save}>Save</button>
            <button class="action-cancel" onclick={crud.cancel}>X</button>
          </td>
        </tr>
      {/if}
      {#each app.configStrategies as entry}
        {#if crud.editing && editingName === entry.name}
          <tr class="tr" data-editing>
            <td class="td"><input class="td-input" bind:value={crud.editing.name} /></td>
            <td class="td"><input class="td-input" bind:value={crud.editing.pairId} /></td>
            <td class="td"><input class="td-input" bind:value={crud.editing.pkEnvVar} /></td>
            <td class="td"><input class="td-input" type="number" bind:value={crud.editing.intervalSec} /></td>
            <td class="td"><input class="td-input" type="number" bind:value={crud.editing.maxPositions} /></td>
            <td class="td"><input class="td-input" type="number" step="0.01" bind:value={crud.editing.allocationPct} /></td>
            <td class="td flex gap-1">
              <button class="action-save" onclick={crud.save}>Save</button>
              <button class="action-cancel" onclick={crud.cancel}>X</button>
            </td>
          </tr>
        {:else}
          <tr class="tr">
            <td class="td font-medium cursor-pointer" onclick={() => crud.startEdit(entry)}>{entry.name}</td>
            <td class="td cursor-pointer" onclick={() => crud.startEdit(entry)}>{entry.pairId}</td>
            <td class="td text-zinc-600">{entry.pkEnvVar}</td>
            <td class="td">{entry.intervalSec}s</td>
            <td class="td">{entry.maxPositions}</td>
            <td class="td">{entry.allocationPct ?? "-"}</td>
            <td class="td flex gap-1">
              <button class="action-edit" onclick={() => crud.startEdit(entry)}>E</button>
              <button class="action-del" onclick={() => { if (confirm(`Delete strategy "${entry.name}"?`)) crud.remove(entry); }}>D</button>
            </td>
          </tr>
        {/if}
      {/each}
    </tbody>
  </table>

  {#if !app.configStrategies.length && !crud.editing}
    <p class="empty-state text-center py-3">No strategies configured</p>
  {/if}
</div>
