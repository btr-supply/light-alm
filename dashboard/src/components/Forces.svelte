<script lang="ts">
  import { app } from "../lib/stores.svelte";
  import ProgressBar from "./ProgressBar.svelte";
  import Section from "./Section.svelte";
  import { fmtNum, cap } from "@btr-supply/shared/format";
  import { forceColor, TEXT, SMALL } from "../lib/theme";
</script>

{#if app.status?.forces}
  <Section title="Forces">
    {#each [
      { key: "v" as const, label: "V", value: cap(app.status.forces.v.force, 0, 100), sub: `σ=${fmtNum(app.status.forces.v.std, 6)}` },
      { key: "m" as const, label: "M", value: cap(app.status.forces.m.force, 0, 100), sub: `↑${app.status.forces.m.up} ↓${app.status.forces.m.down}` },
      { key: "t" as const, label: "T", value: cap(app.status.forces.t.force, 0, 100), sub: `ma ${fmtNum(app.status.forces.t.ma0, 4)}/${fmtNum(app.status.forces.t.ma1, 4)}` },
    ] as force}
      <div class="flex items-center gap-2 text-xs">
        <span class="w-4 {TEXT.label} font-bold">{force.label}</span>
        <ProgressBar value={force.value} color={forceColor(force.value, force.key)} />
        <span class="w-8 text-right {TEXT.value}">{fmtNum(force.value, 0)}</span>
        <span class="w-32 {TEXT.dim} {SMALL} truncate">{force.sub}</span>
      </div>
    {/each}
  </Section>
{/if}
