<script lang="ts">
  import { app, selectPair } from "../lib/stores.svelte";
  import { fmtPct } from "@btr-supply/shared/format";
  import { DECISION, SECTION_HEADER, CARD, STATUS_DOT, EMPTY_STATE, TEXT } from "../lib/theme";

  let totalPositions = $derived(app.pairs.reduce((s, p) => s + p.positions, 0));
  let avgApr = $derived(app.pairs.length > 0 ? app.pairs.reduce((s, p) => s + p.currentApr, 0) / app.pairs.length : 0);
</script>

<div class="p-2 space-y-1">
  {#if app.pairs.length > 0}
    <div class="px-3 py-2 mb-1 {CARD}">
      <h4 class={SECTION_HEADER}>Portfolio</h4>
      <div class="flex justify-between mt-1 text-xs">
        <span class={TEXT.label}>{app.pairs.length} pairs</span>
        <span class={TEXT.label}>{totalPositions} pos</span>
        <span class={TEXT.label}>avg {fmtPct(avgApr, 1)}</span>
      </div>
    </div>
  {/if}

  {#each app.pairs as pair}
    <button
      class="w-full text-left px-3 py-2 rounded text-xs transition-colors
        {app.selectedPairId === pair.id ? 'bg-zinc-800 text-zinc-100' : TEXT.secondary + ' hover:bg-zinc-800/50'}"
      onclick={() => selectPair(pair.id)}
    >
      <div class="flex items-center justify-between">
        <span class="font-medium">{pair.id}</span>
        <span class="{STATUS_DOT} {DECISION[pair.decision]?.dot ?? 'bg-zinc-600'}"></span>
      </div>
      <div class="flex justify-between mt-1 text-xs {TEXT.label}">
        <span>APR {fmtPct(pair.currentApr, 1)}</span>
        <span>{pair.positions} pos</span>
      </div>
    </button>
  {/each}

  {#if app.pairs.length === 0}
    <p class="{EMPTY_STATE} text-center py-4">No pairs running</p>
  {/if}
</div>
