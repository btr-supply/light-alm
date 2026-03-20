<script lang="ts">
  import { api } from "../lib/api";
  import { errMsg, chainName } from "@btr-supply/shared/format";

  let rpcs = $state<Record<string, { rpcs: string[]; source: string }>>({});
  let opError = $state("");
  let editChain = $state<number | null>(null);
  let editRpcs = $state("");

  async function load() {
    try { rpcs = await api.configRpcs() as any; }
    catch (e) { opError = errMsg(e); }
  }

  async function saveRpc() {
    if (editChain === null) return;
    opError = "";
    try {
      await api.saveConfigRpc(editChain, editRpcs.split("\n").map(s => s.trim()).filter(Boolean));
      editChain = null;
      await load();
    } catch (e) { opError = errMsg(e); }
  }

  async function removeRpc(chainId: number) {
    opError = "";
    try { await api.deleteConfigRpc(chainId); await load(); }
    catch (e) { opError = errMsg(e); }
  }

  load();
</script>

<div>
  {#if opError}<div class="error-msg px-2">{opError}</div>{/if}

  {#if editChain !== null}
    <div class="px-2 py-1.5 border-b border-zinc-800 space-y-1">
      <div class="text-2xs text-zinc-200">Edit RPCs: {chainName(editChain)} ({editChain})</div>
      <textarea class="input-sm w-full h-16" bind:value={editRpcs} placeholder="One RPC URL per line"></textarea>
      <div class="flex gap-1">
        <button class="btn-sm btn-primary" onclick={saveRpc}>Save</button>
        <button class="btn-sm btn-ghost" onclick={() => editChain = null}>Cancel</button>
      </div>
    </div>
  {/if}

  <table class="tbl">
    <thead>
      <tr>
        <th class="th">Chain</th>
        <th class="th">Source</th>
        <th class="th">URLs</th>
        <th class="th" style="width:5rem"></th>
      </tr>
    </thead>
    <tbody>
      {#each Object.entries(rpcs) as [chainId, cfg]}
        <tr class="tr">
          <td class="td font-medium">{chainName(Number(chainId))} <span class="text-zinc-600">{chainId}</span></td>
          <td class="td" data-source={cfg.source}>{cfg.source}</td>
          <td class="td">{cfg.rpcs.length}</td>
          <td class="td flex gap-1">
            <button class="action-edit" onclick={() => { editChain = Number(chainId); editRpcs = rpcs[chainId]?.rpcs?.join("\n") ?? ""; }}>E</button>
            {#if cfg.source === "dragonfly"}
              <button class="action-del" onclick={() => removeRpc(Number(chainId))}>Reset</button>
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
