import type { RangeParams } from "../types";
import { cap } from "../../shared/format";
import {
  DEFAULT_FORCE_PARAMS,
  OPT_BOUNDS,
  NM_ALPHA,
  NM_GAMMA,
  NM_RHO,
  NM_SIGMA,
  NM_MAX_EVALS,
  NM_TOL,
} from "../config/params";

const DIM = OPT_BOUNDS.length;

export function rangeParamsToVec(p: RangeParams): number[] {
  return [p.baseMin, p.baseMax, p.vforceExp, p.vforceDivider, p.rsThreshold];
}

export function vecToRangeParams(v: number[]): RangeParams {
  return {
    baseMin: v[0],
    baseMax: v[1],
    vforceExp: v[2],
    vforceDivider: v[3],
    rsThreshold: v[4],
  };
}

export function clampToBounds(v: number[]): number[] {
  return v.map((x, i) => cap(x, OPT_BOUNDS[i].lo, OPT_BOUNDS[i].hi));
}

export function defaultRangeParams(): RangeParams {
  const { baseRange, rsThreshold } = DEFAULT_FORCE_PARAMS;
  return {
    baseMin: baseRange.min,
    baseMax: baseRange.max,
    vforceExp: baseRange.vforceExp,
    vforceDivider: baseRange.vforceDivider,
    rsThreshold,
  };
}

// ---- Nelder-Mead simplex optimizer ----

interface Vertex {
  x: number[];
  f: number;
}

function centroid(vertices: Vertex[], excludeIdx: number): number[] {
  const n = vertices.length - 1;
  const c = Array.from<number>({ length: DIM }).fill(0);
  for (let i = 0; i < vertices.length; i++) {
    if (i === excludeIdx) continue;
    for (let d = 0; d < DIM; d++) c[d] += vertices[i].x[d];
  }
  for (let d = 0; d < DIM; d++) c[d] /= n;
  return c;
}

function reflect(c: number[], worst: number[], alpha: number): number[] {
  return c.map((ci, d) => ci + alpha * (ci - worst[d]));
}

export function nelderMead(
  evalFn: (x: number[]) => number,
  initialGuess: number[],
  perturbScale = 0.1,
): { best: number[]; fitness: number; evals: number } {
  // Initialize simplex: initial guess + DIM perturbation vertices
  // Alternate +/- perturbation direction to avoid degenerate simplex near bounds
  const vertices: Vertex[] = [];
  const g = clampToBounds(initialGuess);
  vertices.push({ x: g, f: evalFn(g) });

  for (let d = 0; d < DIM; d++) {
    const v = [...g];
    const range = OPT_BOUNDS[d].hi - OPT_BOUNDS[d].lo;
    const sign = d % 2 === 0 ? 1 : -1;
    const perturbed = v[d] + sign * range * perturbScale;
    v[d] = cap(perturbed, OPT_BOUNDS[d].lo, OPT_BOUNDS[d].hi);
    // If clamped to same value, try opposite direction
    if (Math.abs(v[d] - g[d]) < range * 1e-6) {
      v[d] = cap(v[d] - sign * range * perturbScale, OPT_BOUNDS[d].lo, OPT_BOUNDS[d].hi);
    }
    vertices.push({ x: v, f: evalFn(v) });
  }

  let evals = DIM + 1;

  for (let iter = 0; iter < NM_MAX_EVALS - evals; iter++) {
    // Sort ascending by fitness (we maximize, so best = last)
    vertices.sort((a, b) => a.f - b.f);
    const worst = vertices[0];
    const secondWorst = vertices[1];
    const best = vertices[DIM];

    // Convergence check
    if (Math.abs(best.f - worst.f) < NM_TOL) break;

    const c = centroid(vertices, 0);

    // Reflect
    const xr = clampToBounds(reflect(c, worst.x, NM_ALPHA));
    const fr = evalFn(xr);
    evals++;

    if (fr >= secondWorst.f && fr <= best.f) {
      vertices[0] = { x: xr, f: fr };
      continue;
    }

    if (fr > best.f) {
      // Expand
      const xe = clampToBounds(reflect(c, worst.x, NM_GAMMA));
      const fe = evalFn(xe);
      evals++;
      vertices[0] = fe > fr ? { x: xe, f: fe } : { x: xr, f: fr };
      continue;
    }

    // Contract
    const xc = clampToBounds(c.map((ci, d) => ci + NM_RHO * (worst.x[d] - ci)));
    const fc = evalFn(xc);
    evals++;

    if (fc > worst.f) {
      vertices[0] = { x: xc, f: fc };
      continue;
    }

    // Shrink: update all vertices except best toward best
    for (let i = 0; i < DIM; i++) {
      const xs = vertices[DIM].x.map((bi, d) => bi + NM_SIGMA * (vertices[i].x[d] - bi));
      const clamped = clampToBounds(xs);
      vertices[i] = { x: clamped, f: evalFn(clamped) };
      evals++;
    }
  }

  vertices.sort((a, b) => a.f - b.f);
  const best = vertices[DIM];
  return { best: best.x, fitness: best.f, evals };
}
