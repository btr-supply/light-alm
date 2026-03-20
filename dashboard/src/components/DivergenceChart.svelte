<script lang="ts">
  import { onMount } from "svelte";
  import { LineSeries, type IChartApi, type ISeriesApi, type IPriceLine } from "lightweight-charts";
  import { app } from "../lib/stores.svelte";
  import { chartColors, LAYOUT } from "../lib/theme";
  import { useChart, toTime, setSeriesData } from "../lib/chartUtils";
  import ChartTabs from "./ChartTabs.svelte";

  const C = chartColors();
  const tabs = ["Range", "Alloc"];
  let mode = $state("Range");
  let tooltip = $state({ visible: false, text: "" });

  let container = $state<HTMLDivElement>(null!);
  let chart: IChartApi | null = null;
  let rangeDivSeries: ISeriesApi<"Line"> | null = null;
  let allocDivSeries: ISeriesApi<"Line"> | null = null;
  let priceLines: { series: ISeriesApi<"Line">; line: IPriceLine }[] = [];

  onMount(() => {
    const ctx = useChart(container, LAYOUT.tertiaryH);
    chart = ctx.chart;

    rangeDivSeries = chart.addSeries(LineSeries, {
      color: C.rangeDivLine, lineWidth: 1,
      priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: true,
      title: "Range Div",
    });
    allocDivSeries = chart.addSeries(LineSeries, {
      color: C.allocDivLine, lineWidth: 1,
      priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: true,
      title: "Alloc Div",
    });

    const rds = rangeDivSeries, ads = allocDivSeries;
    chart.subscribeCrosshairMove((param: any) => {
      if (!param.time || !param.seriesData?.size) { tooltip.visible = false; return; }
      const m = mode;
      if (m === "Range") {
        const d = param.seriesData.get(rds);
        if (d && "value" in d) tooltip = { visible: true, text: `Range: ${d.value.toFixed(4)}` };
        else tooltip.visible = false;
      } else {
        const d = param.seriesData.get(ads);
        if (d && "value" in d) tooltip = { visible: true, text: `Alloc: ${d.value.toFixed(4)}` };
        else tooltip.visible = false;
      }
    });

    return () => { ctx.destroy(); chart = null; };
  });

  // Compute allocation divergence: L1 distance / 2 between current and target
  function allocDivergence(current: { pct: number }[], target: { pct: number }[]): number {
    if (!current.length || !target.length) return 0;
    let sum = 0;
    const len = Math.max(current.length, target.length);
    for (let i = 0; i < len; i++) {
      const c = current[i]?.pct ?? 0;
      const t = target[i]?.pct ?? 0;
      sum += Math.abs(c - t);
    }
    return sum / 2;
  }

  $effect(() => {
    const snaps = app.epochSnapshots;
    const allocHist = app.allocationHistory;
    const candles = app.candles;
    const _mode = mode;
    if (!chart) return;

    // Toggle visibility based on mode
    rangeDivSeries?.applyOptions({ visible: _mode === "Range" });
    allocDivSeries?.applyOptions({ visible: _mode === "Alloc" });

    // Range divergence: 1 - rangeEfficiency from snapshots
    const sortedSnaps = [...snaps].sort((a, b) => a.ts - b.ts);
    setSeriesData(rangeDivSeries, sortedSnaps.map(s => ({ time: toTime(s.ts), value: 1 - s.rangeEfficiency })), candles);

    // Allocation divergence from allocation history
    const sortedAlloc = [...allocHist].sort((a, b) => a.ts - b.ts);
    setSeriesData(allocDivSeries, sortedAlloc.map(a => ({ time: toTime(a.ts), value: allocDivergence(a.currentAllocations, a.targetAllocations) })), candles);

    // Clear old threshold price lines
    for (const { series: s, line } of priceLines) {
      try { s.removePriceLine(line); } catch {}
    }
    priceLines = [];

    // Add threshold lines if we have config
    const config = app.configStrategies.find(c => c.name === app.selectedStrategy);
    if (config && rangeDivSeries) {
      const rsThresh = app.status?.optimizer?.params?.rsThreshold;
      if (rsThresh && rsThresh > 0) {
        try { priceLines.push({ series: rangeDivSeries, line: rangeDivSeries.createPriceLine({ price: rsThresh, color: C.rangeDivLine + "80", lineWidth: 1, lineStyle: 2, axisLabelVisible: false }) }); } catch {}
      }
      if (config.thresholds?.pra > 0 && allocDivSeries) {
        try { priceLines.push({ series: allocDivSeries, line: allocDivSeries.createPriceLine({ price: config.thresholds.pra, color: C.allocDivLine + "80", lineWidth: 1, lineStyle: 2, axisLabelVisible: false }) }); } catch {}
      }
    }
  });
</script>

<div class="chart-wrapper">
  <ChartTabs tabs={tabs} active={mode} onchange={(t) => mode = t} />
  {#if tooltip.visible}
    <div class="absolute top-1 right-2 z-10 chart-tooltip">
      {tooltip.text}
    </div>
  {/if}
  <div bind:this={container} class="flex-1" style="min-height: {LAYOUT.tertiaryH}px"></div>
  {#if app.epochSnapshots.length === 0 && app.allocationHistory.length === 0 && app.candles.length === 0}
    <div class="empty-overlay">No divergence data</div>
  {/if}
</div>
