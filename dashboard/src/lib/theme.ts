import type { DecisionType } from "@btr-supply/shared/types";

// ---- Semantic text colors ----

export const TEXT = {
  primary: "text-zinc-200", // important values, active elements
  value: "text-zinc-300", // regular data values
  secondary: "text-zinc-400", // addresses, tertiary info
  label: "text-zinc-500", // labels, metadata
  dim: "text-zinc-600", // timestamps, subtle info
  positive: "text-green-400",
  negative: "text-red-400",
} as const;

// ---- Layout dimensions ----

export const LAYOUT = {
  sidebarW: "w-60",
  panelW: "w-80",
  chartH: 360,
} as const;

// ---- Typography ----

export const SMALL = "text-[10px]";

// ---- Component patterns ----

export const DECISION: Record<DecisionType, { dot: string; badge: string }> = {
  HOLD: { dot: "bg-green-500", badge: "bg-green-900/50 text-green-400" },
  RS: { dot: "bg-yellow-500", badge: "bg-yellow-900/50 text-yellow-400" },
  PRA: { dot: "bg-red-500", badge: "bg-red-900/50 text-red-400" },
};

export const CHAIN_COLOR: Record<number, string> = {
  1: "bg-blue-500",
  56: "bg-yellow-500",
  8453: "bg-sky-500",
  42161: "bg-violet-500",
  43114: "bg-red-500",
  137: "bg-purple-500",
  999: "bg-emerald-500",
};

export const SECTION_HEADER = `text-xs font-medium ${TEXT.label} uppercase tracking-wider mb-2`;
export const CARD = "bg-zinc-900 rounded border border-zinc-800";
export const STATUS_DOT = "w-2 h-2 rounded-full shrink-0";
export const EMPTY_STATE = `text-xs ${TEXT.dim}`;

export const ALERT = {
  box: "bg-red-950/50 border border-red-800 rounded px-3 py-2 text-xs",
  title: "text-red-400 font-medium",
  msg: "text-red-300",
} as const;

export function forceColor(value: number, type: "v" | "m" | "t"): string {
  if (type === "v") {
    if (value < 20) return "bg-green-500";
    if (value < 50) return "bg-yellow-500";
    return "bg-red-500";
  }
  if (value < 30) return "bg-red-400";
  if (value < 45) return "bg-yellow-400";
  if (value < 55) return "bg-zinc-400";
  if (value < 70) return "bg-green-400";
  return "bg-green-500";
}

export const statusColor: Record<string, string> = {
  success: TEXT.positive,
  reverted: TEXT.negative,
};

export const opIcon: Record<string, string> = {
  burn: "-",
  mint: "+",
  swap: "~",
};

// Hex colors for lightweight-charts (needs raw hex, not Tailwind classes)
export const CHART = {
  text: "#71717a", // zinc-500
  grid: "#27272a", // zinc-800
  crosshair: "#52525b", // zinc-600
  border: "#3f3f46", // zinc-700
  rangeOverlay: "#3b82f680", // blue-500/50
  upCandle: "#22c55e", // green-500
  downCandle: "#ef4444", // red-500
  praMarker: "#ef4444", // red-500
  rsMarker: "#eab308", // yellow-500
} as const;
