<script lang="ts">
  import { app } from "../lib/stores.svelte";
  import { fmtTime, shortAddr, fmtGasCost, chainName } from "@btr-supply/shared/format";
  import { statusColor, opIcon, TEXT, SMALL } from "../lib/theme";
  import Section from "./Section.svelte";
</script>

<Section title="Tx Log ({app.txlog.length})" empty={app.txlog.length === 0} emptyText="No transactions">
  <div class="space-y-0.5 max-h-64 overflow-y-auto">
    {#each app.txlog as tx}
      {@const chain = chainName(tx.chain)}
      <div class="{SMALL} flex items-center gap-1.5 py-0.5">
        <span class="{TEXT.dim} w-10">{fmtTime(tx.ts)}</span>
        <span class="w-3 text-center font-bold {TEXT.secondary}">{opIcon[tx.opType] ?? "?"}</span>
        <span class="w-8 {statusColor[tx.status] ?? TEXT.secondary}">{tx.opType}</span>
        <span class="{TEXT.label} flex-1 truncate">{shortAddr(tx.pool, 8, 0)}</span>
        <span class="{TEXT.dim} w-12 text-right">{fmtGasCost(tx.gasUsed, tx.gasPrice)}</span>
        <span class={TEXT.dim} title={chain}>{chain.slice(0, 4)}</span>
      </div>
    {/each}
  </div>
</Section>
