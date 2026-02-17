<script lang="ts">
  import { app } from "../lib/stores.svelte";
  import ProgressBar from "./ProgressBar.svelte";
  import Section from "./Section.svelte";
  import { fmtPct, shortAddr, chainName } from "@btr-supply/shared/format";
  import { CHAIN_COLOR, STATUS_DOT, TEXT } from "../lib/theme";
</script>

{#each [
  { label: "Target", items: app.allocation?.targetAllocations },
  { label: "Current", items: app.allocation?.currentAllocations },
] as group}
  {#if group.items?.length}
    <Section title="{group.label} Allocation">
      <div class="space-y-1.5">
        {#each group.items as alloc}
          <div class="flex items-center gap-2 text-xs">
            <div class="{STATUS_DOT} {CHAIN_COLOR[alloc.chain] ?? 'bg-zinc-500'}" title="{chainName(alloc.chain)}"></div>
            <span class="{TEXT.secondary} w-24 truncate">{shortAddr(alloc.pool)}</span>
            <ProgressBar value={alloc.pct * 100} color="bg-blue-600/80" height="h-4" label={fmtPct(alloc.pct, 1)} />
            <span class="{TEXT.label} w-16 text-right">{fmtPct(alloc.expectedApr)}</span>
          </div>
        {/each}
      </div>
    </Section>
  {/if}
{/each}
