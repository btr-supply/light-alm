<script lang="ts">
  import { api } from "../lib/api";
  import { errMsg } from "@btr-supply/shared/format";
  import { CHAINS } from "@btr-supply/shared/chains";

  let pairId = $state("USDC-USDT");
  let pools = $state<{ chain: number; address: string; dex: string }[]>([]);
  let loaded = $state(false);
  let opError = $state("");

  async function loadPools() {
    opError = "";
    try {
      pools = await api.configPools(pairId) ?? [];
      loaded = true;
    } catch (e) { opError = errMsg(e); }
  }

  async function save() {
    opError = "";
    try { await api.saveConfigPools(pairId, pools); }
    catch (e) { opError = errMsg(e); }
  }
</script>

<div>
  <div class="flex gap-2 items-center px-2 py-1">
    <span class="text-2xs text-zinc-500">Pair</span>
    <input class="input-sm w-28" bind:value={pairId} placeholder="USDC-USDT" />
    <button class="btn-sm btn-primary" onclick={loadPools}>Load</button>
    {#if loaded}
      <button class="btn-sm btn-ghost"
        onclick={() => pools = [...pools, { chain: 1, address: "", dex: "uni-v3" }]}>+ Add</button>
      <button class="btn-sm btn-primary" onclick={save}>Save</button>
    {/if}
  </div>

  {#if opError}<div class="error-msg px-2">{opError}</div>{/if}

  {#if loaded}
    <table class="tbl">
      <thead>
        <tr>
          <th class="th" style="width:2rem"></th>
          <th class="th">Chain</th>
          <th class="th">Address</th>
          <th class="th">DEX</th>
          <th class="th" style="width:2rem"></th>
        </tr>
      </thead>
      <tbody>
        {#each pools as pool, i}
          <tr class="tr">
            <td class="td"><span class="status-dot" style="background-color: {CHAINS[pool.chain]?.color?.hex ?? '#71717a'}"></span></td>
            <td class="td"><input class="td-input w-14" type="number" bind:value={pool.chain} /></td>
            <td class="td"><input class="td-input" bind:value={pool.address} placeholder="0x..." /></td>
            <td class="td"><input class="td-input w-20" bind:value={pool.dex} placeholder="uni-v3" /></td>
            <td class="td"><button class="action-del" onclick={() => pools = pools.filter((_, j) => j !== i)}>x</button></td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>
