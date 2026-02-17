<script lang="ts">
  import { onMount } from "svelte";
  import { createChart, type IChartApi, type ISeriesApi, type IPriceLine, ColorType } from "lightweight-charts";
  import type { Candle, Position, TxLogEntry } from "@btr-supply/shared/types";
  import { tickToPrice, errMsg } from "@btr-supply/shared/format";
  import { CHART, LAYOUT, TEXT } from "../lib/theme";

  let { candles = [], positions = [], txlog = [] }: {
    candles: Candle[]; positions: Position[]; txlog: TxLogEntry[];
  } = $props();

  let container = $state<HTMLDivElement>(null!);
  let chart: IChartApi | null = null;
  let series: ISeriesApi<"Candlestick"> | null = null;
  let priceLines: IPriceLine[] = [];

  function aggregateToM15(src: Candle[]): Candle[] {
    const period = 15 * 60_000;
    const buckets = new Map<number, Candle>();
    for (const c of src) {
      const key = Math.floor(c.ts / period) * period;
      const existing = buckets.get(key);
      if (!existing) buckets.set(key, { ts: key, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v });
      else { existing.h = Math.max(existing.h, c.h); existing.l = Math.min(existing.l, c.l); existing.c = c.c; existing.v += c.v; }
    }
    return [...buckets.values()].sort((a, b) => a.ts - b.ts);
  }

  const MARKER_CFG = {
    PRA: { position: "aboveBar" as const, color: CHART.praMarker, shape: "arrowDown" as const },
    RS:  { position: "belowBar" as const, color: CHART.rsMarker, shape: "arrowUp" as const },
  };

  const rangeLineOpts = { color: CHART.rangeOverlay, lineWidth: 1 as const, lineStyle: 2 as const, axisLabelVisible: false } as const;

  let chartError = $state("");

  onMount(() => {
    try {
      chart = createChart(container, {
        width: container.clientWidth,
        height: LAYOUT.chartH,
        layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: CHART.text, fontSize: 11 },
        grid: { vertLines: { color: CHART.grid }, horzLines: { color: CHART.grid } },
        crosshair: { vertLine: { color: CHART.crosshair, width: 1 }, horzLine: { color: CHART.crosshair, width: 1 } },
        rightPriceScale: { borderColor: CHART.border },
        timeScale: { borderColor: CHART.border, timeVisible: true, secondsVisible: false },
      });

      series = chart.addCandlestickSeries({
        upColor: CHART.upCandle, downColor: CHART.downCandle,
        borderUpColor: CHART.upCandle, borderDownColor: CHART.downCandle,
        wickUpColor: CHART.upCandle, wickDownColor: CHART.downCandle,
      });
    } catch (e) {
      chartError = errMsg(e);
      return () => {};
    }

    const ro = new ResizeObserver(() => chart?.resize(container.clientWidth, LAYOUT.chartH));
    ro.observe(container);
    return () => { ro.disconnect(); chart?.remove(); chart = null; };
  });

  $effect(() => {
    // Access props before early-return guard so Svelte tracks them
    const _c = candles, _p = positions, _t = txlog;
    if (!series || !chart) return;

    // Clear old price lines
    for (const pl of priceLines) series.removePriceLine(pl);
    priceLines = [];

    if (!_c.length) { series.setData([]); return; }

    const m15 = aggregateToM15(_c);
    series.setData(m15.map(c => ({
      time: Math.floor(c.ts / 1000) as any,
      open: c.o, high: c.h, low: c.l, close: c.c,
    })));

    // Position range overlay
    for (const pos of _p) {
      const lo = tickToPrice(pos.tickLower);
      const hi = tickToPrice(pos.tickUpper);
      priceLines.push(
        series.createPriceLine({ price: lo, ...rangeLineOpts }),
        series.createPriceLine({ price: hi, ...rangeLineOpts }),
      );
    }

    // RS/PRA markers from txlog
    const markers = _t
      .filter(tx => tx.decisionType !== "HOLD" && tx.ts > 0)
      .map(tx => {
        const cfg = MARKER_CFG[tx.decisionType as keyof typeof MARKER_CFG] ?? MARKER_CFG.RS;
        return { time: Math.floor(tx.ts / 1000) as any, ...cfg, text: tx.decisionType };
      })
      .sort((a, b) => (a.time as number) - (b.time as number));
    series.setMarkers(markers);

    chart.timeScale().fitContent();
  });
</script>

{#if chartError}
  <div class="text-xs {TEXT.negative} p-4">Chart error: {chartError}</div>
{:else}
  <div bind:this={container} class="w-full"></div>
{/if}
