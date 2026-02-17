import type { Forces, Candle } from "../src/types";
import { log } from "../src/utils";

/** Suppress log output for tests. Call in beforeAll. */
export function silenceLog() {
  log.setLevel("error");
}

/** Create neutral forces, optionally override v/m/t. */
export function neutralForces(v = 0, m = 50, t = 50): Forces {
  return {
    v: { force: v, mean: 0, std: 0 },
    m: { force: m, up: 0, down: 0 },
    t: { ma0: 0, ma1: 0, force: t },
  };
}

/** Generate candles from explicit close values (forces/range tests). */
export function synthFromCloses(closes: number[], base = 1.0): Candle[] {
  return closes.map((c, i) => ({
    ts: Date.now() - (closes.length - i) * 60_000,
    o: base,
    h: Math.max(base, c) + 0.001,
    l: Math.min(base, c) - 0.001,
    c,
    v: 100,
  }));
}

/** Generate candles with explicit high/low spread (Parkinson volatility tests). */
export function synthHL(count: number, hl: number, base = 1.0): Candle[] {
  return Array.from({ length: count }, (_, i) => ({
    ts: Date.now() - (count - i) * 60_000,
    o: base,
    h: base + hl / 2,
    l: base - hl / 2,
    c: base,
    v: 100,
  }));
}

/** Generate random-walk candles (optimizer tests). */
export function synthRandomWalk(count: number, base = 1.0, vol = 0.002): Candle[] {
  let price = base;
  return Array.from({ length: count }, (_, i) => {
    const move = (Math.random() - 0.5) * 2 * vol;
    price += move;
    return {
      ts: Date.now() - (count - i) * 60_000,
      o: price - move / 2,
      h: price + Math.abs(move),
      l: price - Math.abs(move),
      c: price,
      v: 1000 + Math.random() * 500,
    };
  });
}

/** Aggregate M1 candles to M15 (optimizer tests). */
export function synthM15(m1: Candle[]): Candle[] {
  const result: Candle[] = [];
  for (let i = 0; i < m1.length; i += 15) {
    const slice = m1.slice(i, i + 15);
    if (slice.length === 0) break;
    result.push({
      ts: slice[0].ts,
      o: slice[0].o,
      h: Math.max(...slice.map((c) => c.h)),
      l: Math.min(...slice.map((c) => c.l)),
      c: slice[slice.length - 1].c,
      v: slice.reduce((s, c) => s + c.v, 0),
    });
  }
  return result;
}
