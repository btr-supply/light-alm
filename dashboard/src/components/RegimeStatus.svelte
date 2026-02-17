<script lang="ts">
  import { fmtNum } from "@btr-supply/shared/format";
  import { STATUS_DOT, TEXT } from "../lib/theme";
  import Section from "./Section.svelte";
  import type { RegimeState } from "@btr-supply/shared/types";

  interface Props {
    regime: RegimeState | null;
  }

  let { regime }: Props = $props();
</script>

<Section title="Regime" empty={!regime}>
  {#if regime}
    <div class="flex items-center gap-2 text-xs">
      <span class="{STATUS_DOT} {regime.suppressed ? 'bg-red-500' : 'bg-green-500'}"></span>
      <span class={TEXT.value}>
        {regime.suppressed ? `Suppressed: ${regime.reason}` : "Normal"}
      </span>
    </div>
    {#if regime.widenFactor > 1}
      <div class="text-xs {TEXT.label} mt-1">
        Widen factor: {fmtNum(regime.widenFactor, 1)}x
      </div>
    {/if}
  {/if}
</Section>
