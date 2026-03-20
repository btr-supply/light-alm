<script lang="ts">
  import { app } from "../lib/stores.svelte";
  import { api } from "../lib/api";
  import { createCrud } from "../lib/crud.svelte";
  import type { DexMetadata } from "@btr-supply/shared/types";

  const crud = createCrud<DexMetadata>({
    save: (e) => api.saveConfigDex(e.id, e),
    remove: (e) => api.deleteConfigDex(e.id),
  });

  let editingId = $derived(crud.editing?.id ?? "");
</script>

<div>
  <div class="flex justify-between items-center px-2 py-1">
    <span class="text-2xs text-zinc-500">{app.configDexs.length} DEXs</span>
    <button class="btn-sm btn-primary"
      onclick={() => crud.startNew({ id: "", name: "", ammType: "CLMM", poolTypes: ["v3"] })}>+ New</button>
  </div>

  {#if crud.opError}<div class="error-msg px-2">{crud.opError}</div>{/if}

  <table class="tbl">
    <thead>
      <tr>
        <th class="th">ID</th>
        <th class="th">Name</th>
        <th class="th">AMM</th>
        <th class="th">Types</th>
        <th class="th">URL</th>
        <th class="th" style="width:4rem"></th>
      </tr>
    </thead>
    <tbody>
      {#if crud.editing && !app.configDexs.some(e => e.id === editingId)}
        <tr class="tr">
          <td class="td"><input class="td-input" bind:value={crud.editing.id} placeholder="uni-v3" /></td>
          <td class="td"><input class="td-input" bind:value={crud.editing.name} placeholder="Uniswap V3" /></td>
          <td class="td"><input class="td-input" bind:value={crud.editing.ammType} placeholder="CLMM" /></td>
          <td class="td text-zinc-600">{crud.editing.poolTypes?.join(", ") ?? ""}</td>
          <td class="td"><input class="td-input" bind:value={crud.editing.landingUrl} placeholder="https://..." /></td>
          <td class="td flex gap-1">
            <button class="action-save" onclick={crud.save}>Save</button>
            <button class="action-cancel" onclick={crud.cancel}>X</button>
          </td>
        </tr>
      {/if}
      {#each app.configDexs as entry}
        {#if crud.editing && editingId === entry.id}
          <tr class="tr" data-editing>
            <td class="td"><input class="td-input" bind:value={crud.editing.id} /></td>
            <td class="td"><input class="td-input" bind:value={crud.editing.name} /></td>
            <td class="td"><input class="td-input" bind:value={crud.editing.ammType} /></td>
            <td class="td text-zinc-600">{crud.editing.poolTypes?.join(", ") ?? ""}</td>
            <td class="td"><input class="td-input" bind:value={crud.editing.landingUrl} /></td>
            <td class="td flex gap-1">
              <button class="action-save" onclick={crud.save}>Save</button>
              <button class="action-cancel" onclick={crud.cancel}>X</button>
            </td>
          </tr>
        {:else}
          <tr class="tr">
            <td class="td font-medium cursor-pointer" onclick={() => crud.startEdit(entry)}>{entry.id}</td>
            <td class="td cursor-pointer" onclick={() => crud.startEdit(entry)}>{entry.name}</td>
            <td class="td">{entry.ammType}</td>
            <td class="td text-zinc-600">{entry.poolTypes?.join(", ") ?? ""}</td>
            <td class="td">
              {#if entry.landingUrl}
                <a href={entry.landingUrl} target="_blank" class="text-blue-400 hover:underline truncate block">{entry.landingUrl}</a>
              {:else}
                <span class="text-zinc-600">-</span>
              {/if}
            </td>
            <td class="td flex gap-1">
              <button class="action-edit" onclick={() => crud.startEdit(entry)}>E</button>
              <button class="action-del" onclick={() => { if (confirm(`Delete DEX "${entry.id}"?`)) crud.remove(entry); }}>D</button>
            </td>
          </tr>
        {/if}
      {/each}
    </tbody>
  </table>

  {#if !app.configDexs.length && !crud.editing}
    <p class="empty-state text-center py-3">No DEX metadata configured</p>
  {/if}
</div>
