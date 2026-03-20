<script lang="ts">
  import { onMount } from "svelte";
  import { AreaSeries, type IChartApi, type ISeriesApi } from "lightweight-charts";
  import type { AllocationEntry } from "@btr-supply/shared/types";
  import { app } from "../lib/stores.svelte";
  import { shortAddr, chainName } from "@btr-supply/shared/format";
  import { chartColors, LAYOUT } from "../lib/theme";
  import { useChart, toTime, areaColors } from "../lib/chartUtils";
  import ChartTabs from "./ChartTabs.svelte";

  const C = chartColors();
  const tabs = ["Pool", "Dex", "Chain"];
  let groupBy = $state<"pool" | "dex" | "chain">("pool");
  const tabToGroup: Record<string, "pool" | "dex" | "chain"> = { Pool: "pool", Dex: "dex", Chain: "chain" };

  let container = $state<HTMLDivElement>(null!);
  let chart: IChartApi | null = null;
  let areaSeries: ISeriesApi<"Area">[] = [];
  let tooltip = $state({ visible: false, text: "" });

  const PALETTE = C.palette;

  // Per-timestamp allocation lookup for tooltip
  let allocByTime = new Map<number, Record<string, number>>();

  onMount(() => {
    const ctx = useChart(container, LAYOUT.tertiaryH, true);
    chart = ctx.chart;

    chart.subscribeCrosshairMove((param: any) => {
      if (!param.time || !allocByTime.size) { tooltip.visible = false; return; }
      const data = allocByTime.get(param.time as number);
      if (!data) { tooltip.visible = false; return; }
      const parts = legendItems
        .filter(item => (data[item.key] ?? 0) > 0.001)
        .map(item => `${item.key}: ${((data[item.key] ?? 0) * 100).toFixed(1)}%`);
      tooltip = { visible: true, text: parts.join("  ") };
    });

    return () => { ctx.destroy(); chart = null; };
  });

  // Group allocations by key
  function groupKey(entry: AllocationEntry, by: "pool" | "dex" | "chain"): string {
    if (by === "pool") return `${entry.chain}:${shortAddr(entry.pool, 6, 0)}`;
    if (by === "dex") return entry.dex;
    return chainName(entry.chain);
  }

  // Legend items for display
  let legendItems = $state<{ key: string; color: string }[]>([]);

  $effect(() => {
    const allocHist = app.allocationHistory;
    const candles = app.candles;
    const _groupBy = groupBy;
    if (!chart) return;

    // Remove old series
    for (const s of areaSeries) chart.removeSeries(s);
    areaSeries = [];

    // Zero-backfill when no allocation history but candles exist
    if (!allocHist.length) {
      legendItems = [];
      allocByTime = new Map();
      if (candles.length > 0) {
        const s = chart.addSeries(AreaSeries, {
          ...areaColors(PALETTE[0], 0.4, 0.05),
          lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        });
        s.setData(candles.map(c => ({ time: Math.floor(c.ts / 1000) as any, value: 0 })));
        areaSeries.push(s);
      }
      return;
    }

    const sorted = [...allocHist].sort((a, b) => a.ts - b.ts);

    // Collect all unique group keys
    const keySet = new Set<string>();
    for (const alloc of sorted) {
      for (const entry of alloc.targetAllocations) {
        keySet.add(groupKey(entry, _groupBy));
      }
    }
    const keys = [...keySet];

    legendItems = keys.map((k, i) => ({
      key: k,
      color: PALETTE[i % PALETTE.length],
    }));

    // Build per-timestamp allocation lookup for tooltip
    const lookup = new Map<number, Record<string, number>>();
    for (const alloc of sorted) {
      const byKey: Record<string, number> = {};
      for (const entry of alloc.targetAllocations) {
        const k = groupKey(entry, _groupBy);
        byKey[k] = (byKey[k] ?? 0) + entry.pct;
      }
      lookup.set(toTime(alloc.ts), byKey);
    }
    allocByTime = lookup;

    // Build cumulative stacked data (bottom-up)
    for (let i = keys.length - 1; i >= 0; i--) {
      const key = keys[i];
      const hex = PALETTE[i % PALETTE.length];
      const s = chart.addSeries(AreaSeries, {
        ...areaColors(hex, 0.4, 0.05),
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });

      const data = sorted.map(alloc => {
        let cumPct = 0;
        for (let j = 0; j <= i; j++) {
          const k = keys[j];
          for (const entry of alloc.targetAllocations) {
            if (groupKey(entry, _groupBy) === k) cumPct += entry.pct;
          }
        }
        return { time: toTime(alloc.ts), value: cumPct * 100 };
      });
      s.setData(data);
      areaSeries.push(s);
    }
  });
</script>

<div class="chart-wrapper">
  <ChartTabs tabs={tabs} active={tabs.find(t => tabToGroup[t] === groupBy) ?? "Pool"} onchange={(t) => groupBy = tabToGroup[t] ?? "pool"} />
  {#if tooltip.visible}
    <div class="absolute top-1 right-2 z-10 chart-tooltip">
      {tooltip.text}
    </div>
  {/if}
  <div bind:this={container} class="flex-1" style="min-height: {LAYOUT.tertiaryH}px"></div>
  {#if legendItems.length > 0}
    <div class="flex flex-wrap gap-x-2 gap-y-0.5 px-2 py-0.5 border-t border-zinc-800/40">
      {#each legendItems as item}
        <span class="flex items-center gap-0.5 text-2xs px-1 text-zinc-600">
          <span class="w-2 h-2 shrink-0" style="background: {item.color}"></span>
          {item.key}
        </span>
      {/each}
    </div>
  {/if}
  {#if app.allocationHistory.length === 0 && app.candles.length === 0}
    <div class="empty-overlay">No allocation data</div>
  {/if}
</div>
