<script lang="ts">
  import type { ClusterWorker } from "@btr-supply/shared/types";
  import { api } from "../lib/api";
  import { createAction } from "../lib/crud.svelte";

  let { worker, compact = false }: { worker: ClusterWorker; compact?: boolean } = $props();
  const ctrl = createAction();

  const actions = $derived(worker.workerType === "strategy"
    ? { start: () => api.startStrategy(worker.id), stop: () => api.stopStrategy(worker.id), restart: () => api.restartStrategy(worker.id), pause: () => api.pauseStrategy(worker.id) }
    : { start: () => api.startCollector(worker.id), stop: () => api.stopCollector(worker.id), restart: () => api.restartCollector(worker.id), pause: undefined as (() => Promise<unknown>) | undefined },
  );

  const stopped = $derived(worker.status === "stopped" || worker.status === "error");
</script>

{#if compact}
  <div class="flex items-center gap-0.5 shrink-0">
    {#if stopped}
      <button class="btn-xs btn-primary" disabled={ctrl.busy} onclick={() => ctrl.run(actions.start)}>S</button>
    {:else}
      <button class="btn-xs btn-ghost" disabled={ctrl.busy} onclick={() => ctrl.run(actions.restart)}>R</button>
      <button class="btn-xs btn-danger" disabled={ctrl.busy} onclick={() => ctrl.run(actions.stop)}>X</button>
    {/if}
    {#if ctrl.error}<span class="error-msg text-2xs" title={ctrl.error}>!</span>{/if}
  </div>
{:else}
  <div class="flex gap-1">
    {#if stopped}
      <button class="btn btn-primary" disabled={ctrl.busy} onclick={() => ctrl.run(actions.start)}>Start</button>
    {:else}
      <button class="btn btn-ghost" disabled={ctrl.busy} onclick={() => ctrl.run(actions.restart)}>Restart</button>
      {#if actions.pause}<button class="btn btn-ghost" disabled={ctrl.busy} onclick={() => ctrl.run(actions.pause)}>Pause</button>{/if}
      <button class="btn btn-danger" disabled={ctrl.busy} onclick={() => ctrl.run(actions.stop)}>Stop</button>
    {/if}
  </div>
  {#if ctrl.error}
    <div class="text-2xs error-msg mt-1">{ctrl.error}</div>
  {/if}
{/if}
