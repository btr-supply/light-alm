<script lang="ts">
  import { onMount } from "svelte";
  import { CandlestickSeries, LineSeries, createSeriesMarkers, type IChartApi, type ISeriesApi, type IPriceLine } from "lightweight-charts";
  import type { Candle, Position, TxLogEntry, OptimalRange } from "@btr-supply/shared/types";
  import { tickToPrice, errMsg, aggregateCandles } from "@btr-supply/shared/format";
  import { chartColors, LAYOUT } from "../lib/theme";
  import { useChart, chartSMA, toTime } from "../lib/chartUtils";

  let { candles = [], positions = [], txlog = [], optimalRanges = [], rangeHistory = [] }: {
    candles: Candle[]; positions: Position[]; txlog: TxLogEntry[]; optimalRanges: OptimalRange[];
    rangeHistory: { ts: number; rangeMin: number; rangeMax: number }[];
  } = $props();

  const C = chartColors();

  let container = $state<HTMLDivElement>(null!);
  let densityCanvas = $state<HTMLCanvasElement>(null!);
  let chart: IChartApi | null = null;
  let series: ISeriesApi<"Candlestick"> | null = null;
  let rangeMinSeries: ISeriesApi<"Line"> | null = null;
  let rangeMaxSeries: ISeriesApi<"Line"> | null = null;
  let maShortSeries: ISeriesApi<"Line"> | null = null;
  let maLongSeries: ISeriesApi<"Line"> | null = null;
  let priceLines: IPriceLine[] = [];
  let markersPrimitive: ReturnType<typeof createSeriesMarkers> | null = null;
  let currentPrec = 4;
  let tooltip = $state({ visible: false, o: "", h: "", l: "", c: "" });

  // Parse chart-text hex to RGB once for density histogram
  const _ct = C.text;
  const _dr = parseInt(_ct.slice(1, 3), 16);
  const _dg = parseInt(_ct.slice(3, 5), 16);
  const _db = parseInt(_ct.slice(5, 7), 16);

  function drawDensity(agg: { close: number }[], mtfAvg: number) {
    if (!densityCanvas || !series || !chart) return;
    const ctx = densityCanvas.getContext("2d");
    if (!ctx) return;

    const h = densityCanvas.height;
    const w = densityCanvas.width;
    ctx.clearRect(0, 0, w, h);

    if (agg.length < 2) return;

    const closes = agg.map(c => c.close);
    const minP = Math.min(...closes);
    const maxP = Math.max(...closes);
    if (maxP <= minP) return;

    // Bin closes into N price levels
    const bins = 30;
    const counts = new Array(bins).fill(0);
    for (const p of closes) {
      const idx = Math.min(Math.floor(((p - minP) / (maxP - minP)) * bins), bins - 1);
      counts[idx]++;
    }
    const maxCount = Math.max(...counts);
    if (maxCount === 0) return;

    // Map price range to pixel coordinates using series
    const topCoord = series.priceToCoordinate(maxP);
    const bottomCoord = series.priceToCoordinate(minP);
    if (topCoord === null || bottomCoord === null) return;

    const pxTop = topCoord;
    const pxBottom = bottomCoord;
    const binH = (pxBottom - pxTop) / bins;

    for (let i = 0; i < bins; i++) {
      const barW = (counts[i] / maxCount) * (w - 4);
      const y = pxTop + i * binH;
      ctx.fillStyle = `rgba(${_dr},${_dg},${_db},${0.15 + (counts[i] / maxCount) * 0.45})`;
      ctx.fillRect(2, y, barW, Math.max(binH - 1, 1));
    }

    // MTF weighted-average center line
    if (mtfAvg > 0) {
      const mtfY = series.priceToCoordinate(mtfAvg);
      if (mtfY !== null) {
        ctx.strokeStyle = C.maShort;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(0, mtfY);
        ctx.lineTo(w, mtfY);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Draw position range bands (blue)
    for (const pos of positions) {
      const lo = tickToPrice(pos.tickLower);
      const hi = tickToPrice(pos.tickUpper);
      const yLo = series.priceToCoordinate(lo);
      const yHi = series.priceToCoordinate(hi);
      if (yLo !== null && yHi !== null) {
        ctx.fillStyle = C.positionBand;
        ctx.fillRect(0, Math.min(yLo, yHi), w, Math.abs(yLo - yHi));
      }
    }

    // Draw optimal range bands (green)
    for (const r of optimalRanges) {
      if (r.rangeMin > 0 && r.rangeMax > 0) {
        const yLo = series.priceToCoordinate(r.rangeMin);
        const yHi = series.priceToCoordinate(r.rangeMax);
        if (yLo !== null && yHi !== null) {
          ctx.fillStyle = C.optimalBand;
          ctx.fillRect(0, Math.min(yLo, yHi), w, Math.abs(yLo - yHi));
        }
      }
    }
  }

  const MARKER_CFG = {
    PRA: { position: "aboveBar" as const, color: C.praMarker, shape: "arrowDown" as const },
    RS:  { position: "belowBar" as const, color: C.rsMarker, shape: "arrowUp" as const },
  };

  const rangeLineOpts = { color: C.rangeOverlay, lineWidth: 1 as const, lineStyle: 2 as const, axisLabelVisible: false } as const;

  let chartError = $state("");

  onMount(() => {
    try {
      const ctx = useChart(container, LAYOUT.chartH, true, () => {
        if (densityCanvas) { densityCanvas.width = 80; densityCanvas.height = LAYOUT.chartH; }
      });
      chart = ctx.chart;

      series = chart.addSeries(CandlestickSeries, {
        upColor: C.upCandle, downColor: C.downCandle,
        borderUpColor: C.upCandle, borderDownColor: C.downCandle,
        wickUpColor: C.upCandle, wickDownColor: C.downCandle,
      });

      rangeMinSeries = chart.addSeries(LineSeries, {
        color: C.optimalLine, lineWidth: 1, lineStyle: 2,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      });
      rangeMaxSeries = chart.addSeries(LineSeries, {
        color: C.optimalLine, lineWidth: 1, lineStyle: 2,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      });

      maShortSeries = chart.addSeries(LineSeries, {
        color: C.maShort, lineWidth: 1,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      });
      maLongSeries = chart.addSeries(LineSeries, {
        color: C.maLong, lineWidth: 1,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      });

      const cs = series;
      chart.subscribeCrosshairMove((param: any) => {
        if (!param.time || !param.seriesData?.size || !cs) { tooltip.visible = false; return; }
        const d = param.seriesData.get(cs);
        if (!d || !("open" in d)) { tooltip.visible = false; return; }
        const fmt = (n: number) => n.toFixed(currentPrec);
        tooltip = { visible: true, o: fmt(d.open), h: fmt(d.high), l: fmt(d.low), c: fmt(d.close) };
      });

      return () => { ctx.destroy(); chart = null; };
    } catch (e) {
      chartError = errMsg(e);
      return () => {};
    }
  });

  $effect(() => {
    const _c = candles, _p = positions, _t = txlog, _o = optimalRanges, _rh = rangeHistory;
    if (!series || !chart) return;

    // Clear old price lines
    for (const pl of priceLines) series.removePriceLine(pl);
    priceLines = [];

    // Clear old markers
    if (markersPrimitive) { markersPrimitive.detach(); markersPrimitive = null; }

    if (!_c.length) {
      series.setData([]);
      rangeMinSeries?.setData([]);
      rangeMaxSeries?.setData([]);
      maShortSeries?.setData([]);
      maLongSeries?.setData([]);
      return;
    }

    const agg = aggregateCandles(_c, 5 * 60_000);

    // Auto-detect precision
    const samplePrice = _c[Math.floor(_c.length / 2)]?.c ?? 1;
    const prec = samplePrice > 100 ? 2 : samplePrice > 1 ? 4 : 6;
    currentPrec = prec;
    const minMove = Math.pow(10, -prec);
    series.applyOptions({ priceFormat: { type: "price", precision: prec, minMove } });

    const candleData = agg.map(c => ({
      time: toTime(c.ts),
      open: c.o, high: c.h, low: c.l, close: c.c,
    }));
    series.setData(candleData);

    // Range history lines
    if (_rh.length && rangeMinSeries && rangeMaxSeries) {
      const sorted = [..._rh].sort((a, b) => a.ts - b.ts);
      rangeMinSeries.setData(sorted.map(r => ({ time: toTime(r.ts), value: r.rangeMin })));
      rangeMaxSeries.setData(sorted.map(r => ({ time: toTime(r.ts), value: r.rangeMax })));
    } else {
      rangeMinSeries?.setData([]);
      rangeMaxSeries?.setData([]);
    }

    // MA overlays (8-period short, 16-period long) — compute once, reuse for density
    const closesForMA = candleData.map(c => ({ time: c.time, close: c.close }));
    const shortMA = chartSMA(closesForMA, 8);
    const longMA = chartSMA(closesForMA, 16);
    maShortSeries?.setData(shortMA);
    maLongSeries?.setData(longMA);

    // Position range overlay (static horizontal lines)
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
        return { time: toTime(tx.ts), ...cfg, text: tx.decisionType };
      })
      .sort((a, b) => (a.time as number) - (b.time as number));
    if (markers.length) {
      markersPrimitive = createSeriesMarkers(series, markers);
    }

    chart.timeScale().fitContent();

    // Compute MTF weighted-average (midpoint of short + long MA latest values)
    const mtfAvg = shortMA.length && longMA.length
      ? (shortMA[shortMA.length - 1].value + longMA[longMA.length - 1].value) / 2
      : 0;

    // Draw density histogram after a frame (coordinates need layout)
    const rafId = requestAnimationFrame(() => drawDensity(candleData.map(c => ({ close: c.close })), mtfAvg));
    return () => cancelAnimationFrame(rafId);
  });
</script>

{#if chartError}
  <div class="text-xs text-negative p-4">Chart error: {chartError}</div>
{:else}
  <div class="relative">
    <div bind:this={container} class="w-full"></div>
    <canvas bind:this={densityCanvas} width="80" height={LAYOUT.chartH} class="absolute top-0 left-0 pointer-events-none"></canvas>
    {#if tooltip.visible}
      <div class="absolute top-1 left-22 z-10 chart-tooltip">
        O: {tooltip.o}&ensp;H: {tooltip.h}&ensp;L: {tooltip.l}&ensp;C: {tooltip.c}
      </div>
    {/if}
  </div>
{/if}
