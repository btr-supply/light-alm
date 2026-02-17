<script lang="ts">
  import { app } from "../lib/stores.svelte";
  import { fmtUsd, GAS_COST_USD } from "@btr-supply/shared/format";
  import { CARD, TEXT } from "../lib/theme";
  import Section from "./Section.svelte";
  import Stat from "./Stat.svelte";

  let { feesEarned, gasCost } = $derived.by(() => {
    let fees = 0, gas = 0;
    for (const tx of app.txlog) {
      const delta = tx.outputUsd - tx.inputUsd;
      if (delta > 0) fees += delta;
      if (tx.status === "success") gas += GAS_COST_USD;
    }
    return { feesEarned: fees, gasCost: gas };
  });

  let netPnl = $derived(feesEarned - gasCost);
</script>

{#if app.txlog.length > 0}
  <Section title="P&L Summary">
    <div class="flex items-center gap-4 text-xs {CARD} px-3 py-2">
      <Stat label="Fees" value={fmtUsd(feesEarned)} cls={TEXT.positive} />
      <Stat label="Gas" value={`-${fmtUsd(gasCost)}`} cls={TEXT.negative} />
      <Stat label="Net" value={fmtUsd(netPnl)} cls={netPnl >= 0 ? TEXT.positive : TEXT.negative} />
    </div>
  </Section>
{/if}
