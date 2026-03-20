<script lang="ts">
  import { onMount } from "svelte";
  import { LineSeries, type IChartApi, type ISeriesApi } from "lightweight-charts";
  import { app } from "../lib/stores.svelte";
  import { chartColors, LAYOUT } from "../lib/theme";
  import { useChart, toTime, setSeriesData, dedupSortByTs } from "../lib/chartUtils";
  import ChartTabs from "./ChartTabs.svelte";

  const C = chartColors();
  const forces = [
    { key: "vforce" as const, label: "Vol", color: C.vforceLine },
    { key: "mforce" as const, label: "Mom", color: C.mforceLine },
    { key: "tforce" as const, label: "Trend", color: C.tforceLine },
  ];

  let visible = $state<Record<string, boolean>>({ Vol: true, Mom: true, Trend: true });
  let tooltip = $state({ visible: false, vol: "", mom: "", trend: "" });

  let container = $state<HTMLDivElement>(null!);
  let chart: IChartApi | null = null;
  let seriesMap: Record<string, ISeriesApi<"Line">> = {};

  onMount(() => {
    const ctx = useChart(container, LAYOUT.forceH, true);
    chart = ctx.chart;

    for (const f of forces) {
      seriesMap[f.label] = chart.addSeries(LineSeries, {
        color: f.color, lineWidth: 1,
        priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: true,
      });
    }

    const sm = seriesMap;
    chart.subscribeCrosshairMove((param: any) => {
      if (!param.time || !param.seriesData?.size) { tooltip.visible = false; return; }
      const vals: Record<string, string> = {};
      for (const f of forces) {
        const d = param.seriesData.get(sm[f.label]);
        if (d && "value" in d) vals[f.label] = d.value.toFixed(1);
      }
      tooltip = { visible: true, vol: vals.Vol ?? "", mom: vals.Mom ?? "", trend: vals.Trend ?? "" };
    });

    return ctx.destroy;
  });

  function toggleForce(label: string) {
    visible[label] = !visible[label];
  }

  $effect(() => {
    const analyses = app.analyses;
    const candles = app.candles;
    const _visible = visible;
    if (!chart) return;

    const sorted = dedupSortByTs(analyses);

    for (const f of forces) {
      const s = seriesMap[f.label];
      if (!s) continue;
      s.applyOptions({ visible: _visible[f.label] });
      setSeriesData(s, sorted.map(a => ({ time: toTime(a.ts), value: a[f.key] })), candles);
    }
  });
</script>

<div class="chart-wrapper">
  <div class="absolute top-1 left-2 z-10 flex items-center gap-2">
    <div class="flex gap-0.5 chart-overlay px-1 py-0.5">
      {#each forces as f}
        <button
          class="toggle"
          data-active={visible[f.label] || undefined}
          onclick={() => toggleForce(f.label)}>
          <span class="inline-block w-1.5 h-1.5 rounded-full mr-0.5" style="background: {f.color}"></span>{f.label}
        </button>
      {/each}
    </div>
    {#if tooltip.visible}
      <div class="chart-tooltip">
        Vol: {tooltip.vol}&ensp;Mom: {tooltip.mom}&ensp;Trend: {tooltip.trend}
      </div>
    {/if}
  </div>
  <div bind:this={container} class="flex-1"></div>
  {#if app.analyses.length === 0}
    <div class="empty-overlay">No force data</div>
  {/if}
</div>
