<script lang="ts">
  import { app } from "../lib/stores.svelte";
  import { api } from "../lib/api";
  import { createAction } from "../lib/crud.svelte";
  import type { StrategyStatus } from "@btr-supply/shared/types";
  import { fmtPct, fmtUsd, fmtNum, fmtTime, fmtDuration, cap } from "@btr-supply/shared/format";
  import { forceLevel } from "../lib/theme";
  import ProgressBar from "./ProgressBar.svelte";
  import CollapsibleSection from "./CollapsibleSection.svelte";

  let expanded = $state<Record<string, boolean>>({ metadata: true, performance: true, optimizer: false, forces: false, config: false });

  const status = $derived(app.status);
  const strat = $derived(status && "name" in status ? status as StrategyStatus : null);
  const stratName = $derived(app.selectedStrategy || strat?.name || "");
  const pairId = $derived(strat?.pairId ?? status?.id ?? "");
  const stratStatus = $derived(strat?.status ?? "unknown");
  const currentApr = $derived(app.allocation?.currentApr ?? strat?.currentApr ?? 0);
  const optimalApr = $derived(app.allocation?.optimalApr ?? strat?.optimalApr ?? 0);

  // Worker for this strategy (matched by id)
  const worker = $derived(
    app.cluster?.strategies.find(w => w.id === stratName) ?? null
  );

  // Performance from latest epoch snapshot
  const latestSnap = $derived(
    app.epochSnapshots.length ? app.epochSnapshots[app.epochSnapshots.length - 1] : null
  );

  // Config from configStrategies
  const config = $derived(
    app.configStrategies.find(c => c.name === stratName) ?? null
  );

  const ctrl = createAction();

  const ksLabels: Record<string, string> = {
    negative_trailing_yield: "Negative yield",
    excessive_rs: "Excessive RS",
    pathological_range: "Pathological range",
    gas_budget_exceeded: "Gas budget exceeded",
  };
</script>

{#if status}
<div class="overflow-y-auto text-xs">
  <!-- Action buttons — pinned top -->
  <div class="flex items-center gap-1 px-2 py-1.5 border-b border-zinc-800">
    {#if stratStatus === "stopped" || stratStatus === "error"}
      <button class="btn btn-primary" disabled={ctrl.busy} onclick={() => ctrl.run(() => api.startStrategy(stratName))}>Start</button>
    {:else}
      <button class="btn btn-ghost" disabled={ctrl.busy} onclick={() => ctrl.run(() => api.restartStrategy(stratName))}>Restart</button>
      <button class="btn btn-ghost" disabled={ctrl.busy} onclick={() => ctrl.run(() => api.pauseStrategy(stratName))}>Pause</button>
      <button class="btn btn-danger" disabled={ctrl.busy} onclick={() => ctrl.run(() => api.stopStrategy(stratName))}>Stop</button>
    {/if}
    {#if ctrl.error}<span class="error-msg text-2xs ml-1">{ctrl.error}</span>{/if}
  </div>

  <!-- Kill switch alert -->
  {#if status.killSwitch?.active}
    <div class="alert m-1">
      <span class="alert-title">Kill Switch: </span>
      <span class="alert-msg">{ksLabels[status.killSwitch.reason] ?? status.killSwitch.reason}</span>
    </div>
  {/if}

  <CollapsibleSection title="Metadata" bind:expanded={expanded.metadata}>
    <div class="flex justify-between"><span class="text-zinc-500">Strategy</span><span class="text-zinc-300">{stratName}</span></div>
    <div class="flex justify-between"><span class="text-zinc-500">Pair</span><span class="text-zinc-300">{pairId}</span></div>
    <div class="flex justify-between">
      <span class="text-zinc-500">Decision</span>
      <span class="decision-badge" data-decision={status.decision}>{status.decision}</span>
    </div>
    <div class="flex justify-between"><span class="text-zinc-500">Epoch</span><span class="text-zinc-300">E{status.epoch}</span></div>
    <div class="flex justify-between">
      <span class="text-zinc-500">Status</span>
      <span class="flex items-center gap-1">
        <span class="status-dot" data-status={stratStatus}></span>
        <span class="text-zinc-300">{stratStatus}</span>
      </span>
    </div>
    {#if worker}
      <div class="flex justify-between"><span class="text-zinc-500">Uptime</span><span class="text-zinc-300">{fmtDuration(worker.uptimeMs, true)}</span></div>
    {/if}
    {#if config?.pkEnvVar}
      <div class="flex justify-between"><span class="text-zinc-500">EOA</span><span class="text-zinc-600">{config.pkEnvVar}</span></div>
    {/if}
    <div class="flex justify-between"><span class="text-zinc-500">Last</span><span class="text-zinc-600">{fmtTime(status.decisionTs)}</span></div>
  </CollapsibleSection>

  <CollapsibleSection title="Performance" bind:expanded={expanded.performance}>
    <div class="flex justify-between">
      <span class="text-zinc-500">Current APR</span>
      <span class="text-zinc-300">{fmtPct(currentApr)}</span>
    </div>
    <div class="flex justify-between">
      <span class="text-zinc-500">Optimal APR</span>
      <span class="text-zinc-300">{fmtPct(optimalApr)}</span>
    </div>
    {#if optimalApr > currentApr}
      <div class="flex justify-between">
        <span class="text-zinc-500">Delta</span>
        <span class="text-positive">+{fmtPct(optimalApr - currentApr)}</span>
      </div>
    {/if}
    {#if latestSnap}
      <div class="flex justify-between">
        <span class="text-zinc-500">Net PnL</span>
        <span class={latestSnap.netPnlUsd >= 0 ? "text-positive" : "text-negative"}>{fmtUsd(latestSnap.netPnlUsd)}</span>
      </div>
      <div class="flex justify-between">
        <span class="text-zinc-500">Fees</span>
        <span class="text-positive">{fmtUsd(latestSnap.feesEarnedUsd)}</span>
      </div>
      <div class="flex justify-between">
        <span class="text-zinc-500">Gas</span>
        <span class="text-negative">-{fmtUsd(latestSnap.gasSpentUsd)}</span>
      </div>
      <div class="flex justify-between">
        <span class="text-zinc-500">IL</span>
        <span class="text-negative">-{fmtUsd(latestSnap.ilUsd)}</span>
      </div>
      <div class="flex justify-between">
        <span class="text-zinc-500">Range Eff.</span>
        <span class="text-zinc-300">{fmtPct(latestSnap.rangeEfficiency)}</span>
      </div>
      <div class="flex justify-between">
        <span class="text-zinc-500">TVL</span>
        <span class="text-zinc-300">{fmtUsd(latestSnap.portfolioValueUsd)}</span>
      </div>
    {/if}
    <div class="flex justify-between">
      <span class="text-zinc-500">Positions</span>
      <span class="text-zinc-300">{app.positions.length}</span>
    </div>
  </CollapsibleSection>

  <CollapsibleSection title="Optimizer" bind:expanded={expanded.optimizer}>
    {#if status.optimizer?.params}
      {#each [
        ["baseMin", fmtNum(status.optimizer.params.baseMin, 5)],
        ["baseMax", fmtNum(status.optimizer.params.baseMax, 4)],
        ["vforceExp", fmtNum(status.optimizer.params.vforceExp, 3)],
        ["vforceDivider", fmtNum(status.optimizer.params.vforceDivider, 0)],
        ["rsThreshold", fmtNum(status.optimizer.params.rsThreshold, 3)],
        ["fitness", fmtNum(status.optimizer.fitness, 6)],
      ] as item}
        <div class="flex justify-between"><span class="text-zinc-500">{item[0]}</span><span class="text-zinc-300">{item[1]}</span></div>
      {/each}
    {:else}
      <div class="text-2xs text-zinc-600">No optimizer data</div>
    {/if}
    {#if status.regime}
      <div class="flex items-center gap-1.5 mt-1">
        <span class="status-dot" data-status={status.regime.suppressed ? "error" : "running"}></span>
        <span class="text-zinc-300">{status.regime.suppressed ? `Suppressed: ${status.regime.reason}` : "Normal"}</span>
      </div>
      {#if status.regime.widenFactor > 1}
        <div class="flex justify-between"><span class="text-zinc-500">Widen</span><span class="text-zinc-300">{fmtNum(status.regime.widenFactor, 1)}x</span></div>
      {/if}
    {/if}
  </CollapsibleSection>

  {#if status.forces}
    <CollapsibleSection title="Forces" bind:expanded={expanded.forces}>
      <div class="space-y-1.5">
        {#each [
          { key: "v" as const, label: "V", value: cap(status.forces.v.force, 0, 100), sub: `\u03C3=${fmtNum(status.forces.v.std, 6)}` },
          { key: "m" as const, label: "M", value: cap(status.forces.m.force, 0, 100), sub: `\u2191${fmtNum(status.forces.m.up, 1)} \u2193${fmtNum(status.forces.m.down, 1)}` },
          { key: "t" as const, label: "T", value: cap(status.forces.t.force, 0, 100), sub: `${fmtNum(status.forces.t.ma0, 4)}/${fmtNum(status.forces.t.ma1, 4)}` },
        ] as force}
          <div class="flex items-center gap-1.5 text-2xs">
            <span class="w-3 text-zinc-500 font-bold">{force.label}</span>
            <ProgressBar value={force.value} level={forceLevel(force.value, force.key)} height="h-1.5" />
            <span class="w-6 text-right text-zinc-300">{fmtNum(force.value, 0)}</span>
            <span class="w-24 text-zinc-600 truncate">{force.sub}</span>
          </div>
        {/each}
      </div>
    </CollapsibleSection>
  {/if}

  {#if config}
    <CollapsibleSection title="Config" bind:expanded={expanded.config}>
      <div class="flex justify-between"><span class="text-zinc-500">Interval</span><span class="text-zinc-300">{config.intervalSec}s</span></div>
      <div class="flex justify-between"><span class="text-zinc-500">Max Pos</span><span class="text-zinc-300">{config.maxPositions}</span></div>
      <div class="flex justify-between"><span class="text-zinc-500">PRA Thresh</span><span class="text-zinc-300">{fmtPct(config.thresholds.pra)}</span></div>
      <div class="flex justify-between"><span class="text-zinc-500">RS Thresh</span><span class="text-zinc-300">{fmtPct(config.thresholds.rs)}</span></div>
      <div class="flex justify-between"><span class="text-zinc-500">Pools</span><span class="text-zinc-300">{config.pools.length}</span></div>
      {#if config.allocationPct != null}
        <div class="flex justify-between"><span class="text-zinc-500">Alloc %</span><span class="text-zinc-300">{fmtPct(config.allocationPct)}</span></div>
      {/if}
      {#if config.gasReserves}
        <div class="text-zinc-500 mt-1">Gas reserves:</div>
        {#each Object.entries(config.gasReserves) as [chain, amount]}
          <div class="flex justify-between pl-2"><span class="text-zinc-600">Chain {chain}</span><span class="text-zinc-300">{amount}</span></div>
        {/each}
      {/if}
    </CollapsibleSection>
  {/if}
</div>
{/if}
