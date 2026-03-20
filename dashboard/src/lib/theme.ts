// ---- Layout dimensions (numeric, used by chart creation) ----

export const LAYOUT = {
  chartH: 460,
  secondaryH: 200,
  tertiaryH: 150,
  forceH: 100,
} as const;

// ---- CSS custom property reader (cached) ----

const varCache = new Map<string, string>();
export function cssVar(name: string): string {
  let v = varCache.get(name);
  if (!v) {
    v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    varCache.set(name, v);
  }
  return v;
}

// ---- Chart colors from :root CSS vars ----

let _cc: ReturnType<typeof buildChartColors> | null = null;
function buildChartColors() {
  return {
    bg: cssVar("--chart-bg"), text: cssVar("--chart-text"),
    grid: cssVar("--chart-grid"), crosshair: cssVar("--chart-crosshair"),
    border: cssVar("--chart-border"),
    upCandle: cssVar("--chart-up-candle"), downCandle: cssVar("--chart-down-candle"),
    praMarker: cssVar("--chart-pra-marker"), rsMarker: cssVar("--chart-rs-marker"),
    hold: cssVar("--chart-hold"), rangeOverlay: cssVar("--chart-range-overlay"),
    positionBand: cssVar("--chart-position-band"),
    optimalBand: cssVar("--chart-optimal-band"), optimalLine: cssVar("--chart-optimal-line"),
    maShort: cssVar("--chart-ma-short"), maLong: cssVar("--chart-ma-long"),
    vforceLine: cssVar("--chart-vforce"), mforceLine: cssVar("--chart-mforce"), tforceLine: cssVar("--chart-tforce"),
    currentApr: cssVar("--chart-current-apr"), optimalApr: cssVar("--chart-optimal-apr"),
    rangeDivLine: cssVar("--chart-range-div"), allocDivLine: cssVar("--chart-alloc-div"),
    palette: Array.from({ length: 8 }, (_, i) => cssVar(`--chart-palette-${i}`)),
  };
}
export function chartColors() { return _cc ??= buildChartColors(); }

/** Decision type → chart hex for lightweight-charts markers */
export function chartDecisionColor(d: string): string {
  if (d === "HOLD") return cssVar("--chart-hold");
  if (d === "PRA") return cssVar("--chart-pra-marker");
  return cssVar("--chart-rs-marker");
}

/** Force value → data-level attribute string for progress-fill CSS */
export function forceLevel(value: number, type: "v" | "m" | "t"): string {
  if (type === "v") {
    if (value < 20) return "v-low";
    if (value < 50) return "v-mid";
    return "v-high";
  }
  if (value < 30) return "mt-vlow";
  if (value < 45) return "mt-low";
  if (value < 55) return "mt-mid";
  if (value < 70) return "mt-high";
  return "mt-vhigh";
}
