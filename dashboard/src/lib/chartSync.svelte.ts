import type { IChartApi, LogicalRange, MouseEventParams } from "lightweight-charts";

interface ChartEntry {
  unsubRange: () => void;
  unsubCrosshair: () => void;
}

const charts = new Map<IChartApi, ChartEntry>();
let syncing = false;

export function registerChart(chart: IChartApi) {
  const rangeHandler = (range: LogicalRange | null) => {
    if (syncing || !range) return;
    syncing = true;
    requestAnimationFrame(() => {
      for (const [c] of charts) {
        if (c !== chart) c.timeScale().setVisibleLogicalRange(range);
      }
      syncing = false;
    });
  };

  const crosshairHandler = (param: MouseEventParams) => {
    if (syncing) return;
    syncing = true;
    for (const [c] of charts) {
      if (c === chart) continue;
      if (param.time) {
        const s = c.panes()[0]?.getSeries()[0];
        if (s) c.setCrosshairPosition(NaN, param.time, s);
      } else {
        c.clearCrosshairPosition();
      }
    }
    syncing = false;
  };

  chart.timeScale().subscribeVisibleLogicalRangeChange(rangeHandler);
  chart.subscribeCrosshairMove(crosshairHandler);

  charts.set(chart, {
    unsubRange: () => chart.timeScale().unsubscribeVisibleLogicalRangeChange(rangeHandler),
    unsubCrosshair: () => chart.unsubscribeCrosshairMove(crosshairHandler),
  });
}

export function unregisterChart(chart: IChartApi) {
  const entry = charts.get(chart);
  if (entry) {
    entry.unsubRange();
    entry.unsubCrosshair();
  }
  charts.delete(chart);
}
