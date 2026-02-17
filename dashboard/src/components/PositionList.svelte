<script lang="ts">
  import { fmtPct, shortAddr, chainName } from "@btr-supply/shared/format";
  import { CARD, TEXT } from "../lib/theme";
  import Section from "./Section.svelte";
  import type { Position } from "@btr-supply/shared/types";

  interface Props {
    positions: Position[];
  }

  let { positions }: Props = $props();
</script>

<Section title="Positions ({positions.length})" empty={positions.length === 0} emptyText="None">
  <div class="space-y-1">
    {#each positions as pos}
      <div class="text-xs {CARD} px-2 py-1.5">
        <div class="flex justify-between">
          <span class={TEXT.secondary}>{shortAddr(pos.pool, 10, 0)}</span>
          <span class={TEXT.label}>{chainName(pos.chain)}</span>
        </div>
        <div class="flex justify-between mt-0.5 {TEXT.label}">
          <span>ticks [{pos.tickLower}, {pos.tickUpper}]</span>
          <span>APR {fmtPct(pos.entryApr, 1)}</span>
        </div>
      </div>
    {/each}
  </div>
</Section>
