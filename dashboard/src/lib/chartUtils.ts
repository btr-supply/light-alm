import { createChart, ColorType, type IChartApi, type ISeriesApi } from "lightweight-charts";
import type { UTCTimestamp } from "lightweight-charts";
import { chartColors } from "./theme";
import { registerChart, unregisterChart } from "./chartSync.svelte";
import { sma } from "@btr-supply/shared/format";

export const toTime = (ts: number) => Math.floor(ts / 1000) as UTCTimestamp;

export function backfillZeros(candles: { ts: number }[]) {
  return candles.map((c) => ({ time: toTime(c.ts), value: 0 }));
}

/** Set series data with zero-backfill fallback when data is empty but candles exist. */
export function setSeriesData(
  series: ISeriesApi<any> | null,
  data: { time: UTCTimestamp; value: number }[],
  candles: { ts: number }[],
) {
  if (!series) return;
  if (data.length > 0) series.setData(data);
  else if (candles.length > 0) series.setData(backfillZeros(candles));
  else series.setData([]);
}

/** Deduplicate items by `.ts` (last wins) and sort ascending. */
export function dedupSortByTs<T extends { ts: number }>(items: T[]): T[] {
  const byTs = new Map<number, T>();
  for (const item of items) byTs.set(item.ts, item);
  return [...byTs.values()].sort((a, b) => a.ts - b.ts);
}

/** SMA for lightweight-charts line data. Uses the shared O(n) sliding window. */
export function chartSMA(data: { time: any; close: number }[], period: number): { time: any; value: number }[] {
  const values = data.map((d) => d.close);
  const result = sma(values, period);
  return result.map((v, i) => ({ time: data[i + period - 1].time, value: v }));
}

/** hex → { lineColor, topColor, bottomColor } for AreaSeries */
export function areaColors(hex: string, topAlpha = 0.3, botAlpha = 0.02) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { lineColor: hex, topColor: `rgba(${r},${g},${b},${topAlpha})`, bottomColor: `rgba(${r},${g},${b},${botAlpha})` };
}

/** Build chart options from CSS custom properties */
export function chartOptions(w: number, h: number) {
  const c = chartColors();
  return {
    width: w, height: h,
    layout: { background: { type: ColorType.Solid, color: c.bg }, textColor: c.text, fontSize: 10 },
    grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
    crosshair: { vertLine: { color: c.crosshair, width: 1 as const }, horzLine: { color: c.crosshair, width: 1 as const } },
    rightPriceScale: { borderColor: c.border },
    timeScale: { borderColor: c.border, timeVisible: true, secondsVisible: false },
  };
}

/** Create chart with ResizeObserver and sync registration. Returns chart + destroy fn. */
export function useChart(
  container: HTMLDivElement,
  height: number,
  hideTime = false,
  onResize?: () => void,
): { chart: IChartApi; destroy: () => void } {
  const opts = chartOptions(container.clientWidth, height);
  if (hideTime) (opts.timeScale as any).visible = false;
  const chart = createChart(container, opts);
  registerChart(chart);
  const ro = new ResizeObserver(() => {
    chart.resize(container.clientWidth, height);
    onResize?.();
  });
  ro.observe(container);
  return {
    chart,
    destroy() {
      ro.disconnect();
      unregisterChart(chart);
      chart.remove();
    },
  };
}
