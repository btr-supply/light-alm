<script lang="ts">
  import { onMount } from "svelte";
  import { LineSeries, AreaSeries, createSeriesMarkers, type IChartApi, type ISeriesApi } from "lightweight-charts";
  import { app } from "../lib/stores.svelte";
  import { chartColors, chartDecisionColor, LAYOUT } from "../lib/theme";
  import { pairTokens } from "@btr-supply/shared/format";
  import { useChart, toTime, setSeriesData, areaColors } from "../lib/chartUtils";
  import ChartTabs from "./ChartTabs.svelte";

  const C = chartColors();
  const tabs = ["APR", "Perf %", "TVL"];
  let mode = $state("APR");

  // TVL denomination: USD by default, or Token A / Token B
  let tvlDenom = $state<"USD" | "A" | "B">("USD");

  const tokens = $derived(pairTokens((app.status as any)?.pairId ?? ""));

  let container = $state<HTMLDivElement>(null!);
  let chart: IChartApi | null = null;
  let tooltip = $state({ visible: false, label: "", value: "" });

  // APR series
  let currentAprSeries: ISeriesApi<"Line"> | null = null;
  let optimalAprSeries: ISeriesApi<"Line"> | null = null;
  let markersPrimitive: ReturnType<typeof createSeriesMarkers> | null = null;

  // TVL / Perf series (shared AreaSeries)
  let tvlSeries: ISeriesApi<"Area"> | null = null;

  onMount(() => {
    const ctx = useChart(container, LAYOUT.secondaryH, true);
    chart = ctx.chart;

    currentAprSeries = chart.addSeries(LineSeries, {
      color: C.currentApr, lineWidth: 2,
      priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: true,
    });
    optimalAprSeries = chart.addSeries(LineSeries, {
      color: C.optimalApr, lineWidth: 1, lineStyle: 2,
      priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: true,
    });
    tvlSeries = chart.addSeries(AreaSeries, {
      ...areaColors(C.currentApr),
      lineWidth: 2, priceLineVisible: false, lastValueVisible: true,
    });

    const cas = currentAprSeries, oas = optimalAprSeries, ts = tvlSeries;
    chart.subscribeCrosshairMove((param: any) => {
      if (!param.time || !param.seriesData?.size) { tooltip.visible = false; return; }
      const m = mode;
      if (m === "APR") {
        const cd = param.seriesData.get(cas);
        const od = param.seriesData.get(oas);
        const cv = cd && "value" in cd ? cd.value.toFixed(2) + "%" : "";
        const ov = od && "value" in od ? od.value.toFixed(2) + "%" : "";
        tooltip = { visible: true, label: "APR", value: `Current: ${cv}  Optimal: ${ov}` };
      } else if (m === "Perf %") {
        const d = param.seriesData.get(ts);
        const v = d && "value" in d ? d.value.toFixed(2) + "%" : "";
        tooltip = { visible: true, label: "Perf", value: `Perf: ${v}` };
      } else {
        const d = param.seriesData.get(ts);
        const v = d && "value" in d ? d.value.toFixed(2) : "";
        tooltip = { visible: true, label: "TVL", value: `TVL: ${v}` };
      }
    });

    return () => { ctx.destroy(); chart = null; };
  });

  // Find the analysis closest in time to a given timestamp
  function nearestAnalysis(ts: number, sorted: typeof app.analyses) {
    if (!sorted.length) return null;
    let best = sorted[0], bestDist = Math.abs(ts - sorted[0].ts);
    for (let i = 1; i < sorted.length; i++) {
      const dist = Math.abs(ts - sorted[i].ts);
      if (dist < bestDist) { best = sorted[i]; bestDist = dist; }
      else break; // sorted ascending, so distance will only grow
    }
    return best;
  }

  $effect(() => {
    const snaps = app.epochSnapshots;
    const candles = app.candles;
    const _mode = mode;
    const _denom = tvlDenom;
    const poolAnalyses = app.analyses;
    if (!chart) return;

    // Clean up markers
    if (markersPrimitive) { markersPrimitive.detach(); markersPrimitive = null; }

    const sorted = [...snaps].sort((a, b) => a.ts - b.ts);
    const sortedAnalyses = [...poolAnalyses].sort((a, b) => a.ts - b.ts);

    if (_mode === "APR") {
      setSeriesData(currentAprSeries, sorted.map(s => ({ time: toTime(s.ts), value: s.currentApr * 100 })), candles);
      setSeriesData(optimalAprSeries, sorted.map(s => ({ time: toTime(s.ts), value: s.optimalApr * 100 })), candles);
      tvlSeries?.setData([]);
      currentAprSeries?.applyOptions({ visible: true });
      optimalAprSeries?.applyOptions({ visible: true });
      tvlSeries?.applyOptions({ visible: false });

      // Decision markers on currentApr line
      const markers = sorted
        .filter(s => s.decision !== "HOLD")
        .map(s => ({
          time: toTime(s.ts),
          position: "inBar" as const,
          color: chartDecisionColor(s.decision),
          shape: "circle" as const,
          text: s.decision,
        }));
      if (markers.length && currentAprSeries) {
        markersPrimitive = createSeriesMarkers(currentAprSeries, markers);
      }
    } else if (_mode === "Perf %") {
      currentAprSeries?.applyOptions({ visible: false });
      optimalAprSeries?.applyOptions({ visible: false });
      tvlSeries?.applyOptions({ visible: true });
      tvlSeries?.applyOptions(areaColors(C.optimalApr));

      const initial = sorted[0]?.portfolioValueUsd ?? 0;
      setSeriesData(tvlSeries, sorted.map(s => ({ time: toTime(s.ts), value: initial > 0 ? (s.netPnlUsd / initial) * 100 : 0 })), candles);
      currentAprSeries?.setData([]);
      optimalAprSeries?.setData([]);
    } else {
      // TVL mode — convert using per-epoch analysis data when available
      currentAprSeries?.applyOptions({ visible: false });
      optimalAprSeries?.applyOptions({ visible: false });
      tvlSeries?.applyOptions({ visible: true });
      tvlSeries?.applyOptions(areaColors(C.currentApr));

      const tvlData = (_denom === "USD" || !sortedAnalyses.length)
        ? sorted.map(s => ({ time: toTime(s.ts), value: s.portfolioValueUsd }))
        : sorted.map(s => {
          const a = nearestAnalysis(s.ts, sortedAnalyses);
          if (!a || a.basePriceUsd <= 0) return { time: toTime(s.ts), value: s.portfolioValueUsd };
          if (_denom === "A") return { time: toTime(s.ts), value: s.portfolioValueUsd / a.basePriceUsd };
          const rate = a.exchangeRate > 0 ? a.exchangeRate : 1;
          return { time: toTime(s.ts), value: s.portfolioValueUsd / (a.basePriceUsd * rate) };
        });
      setSeriesData(tvlSeries, tvlData, candles);
      currentAprSeries?.setData([]);
      optimalAprSeries?.setData([]);
    }
  });
</script>

<div class="chart-wrapper">
  <ChartTabs tabs={tabs} active={mode} onchange={(t) => mode = t} />
  {#if tooltip.visible}
    <div class="absolute top-1 right-2 z-10 chart-tooltip">
      {tooltip.value}
    </div>
  {/if}
  {#if mode === "TVL" && app.analyses.length > 0}
    <div class="absolute top-5 right-2 z-10 flex gap-0.5 chart-overlay px-1 py-0.5">
      {#each [["USD", "USD"], ["A", tokens[0]], ["B", tokens[1]]] as [key, label]}
        <button class="toggle" data-active={tvlDenom === key || undefined}
          onclick={() => tvlDenom = key as any}>{label}</button>
      {/each}
    </div>
  {/if}
  <div bind:this={container} class="flex-1"></div>
  {#if app.epochSnapshots.length === 0 && app.candles.length === 0}
    <div class="empty-overlay">No snapshot data</div>
  {/if}
</div>
