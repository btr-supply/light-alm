<script lang="ts">
  import { app } from "../lib/stores.svelte";
  import TxLog from "./TxLog.svelte";
  import AlertBanner from "./AlertBanner.svelte";
  import StatGrid from "./StatGrid.svelte";
  import RegimeStatus from "./RegimeStatus.svelte";
  import PositionList from "./PositionList.svelte";
  import { fmtNum } from "@btr-supply/shared/format";

  const ksLabels: Record<string, string> = {
    negative_trailing_yield: "Negative yield",
    excessive_rs: "Excessive RS",
    pathological_range: "Pathological range",
    gas_budget_exceeded: "Gas budget exceeded",
  };
</script>

<div class="p-3 space-y-4">
  {#if app.status}
    {#if app.status.killSwitch?.active}
      <AlertBanner title="Kill Switch" message={ksLabels[app.status.killSwitch.reason] ?? app.status.killSwitch.reason} />
    {/if}

    {@const { params, fitness } = app.status.optimizer}
    <StatGrid title="Optimizer" items={[
      ["baseMin", fmtNum(params.baseMin, 5)],
      ["baseMax", fmtNum(params.baseMax, 4)],
      ["vforceExp", fmtNum(params.vforceExp, 3)],
      ["vforceDivider", fmtNum(params.vforceDivider, 0)],
      ["rsThreshold", fmtNum(params.rsThreshold, 3)],
      ["fitness", fmtNum(fitness, 6)],
    ]} />
    <RegimeStatus regime={app.status.regime} />
    <PositionList positions={app.positions} />
  {/if}

  <TxLog />
</div>
