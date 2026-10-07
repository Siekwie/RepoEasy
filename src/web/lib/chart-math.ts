/** Pure chart maths: ticks, scales and layout. No React, no DOM, so it can be unit-tested. */
import { dayMs } from './format.ts';

export const DAY = 86_400_000;

export interface ChartPoint {
  day: string;
  v: number | null;
  /** Drawn dashed (e.g. reconstructed star history). */
  flag?: boolean;
}
export interface ChartSeries {
  key: string;
  label: string;
  /** CSS colour, usually a `var(--s1)` token. */
  color: string;
  type?: 'area' | 'line';
  data: ChartPoint[];
}

export interface PreparedPoint {
  t: number;
  day: string;
  v: number;
  flag: boolean;
}
export interface Prepared {
  key: string;
  label: string;
  color: string;
  type: 'area' | 'line';
  pts: PreparedPoint[];
}

const tickFmt = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 });
/** Axis label: like `compact` but with a second decimal so neighbouring ticks (16.85k) stay distinct. */
export const tickLabel = (n: number): string => tickFmt.format(n).replace(/(\d)K$/, '$1k');

export function niceNum(x: number, round: boolean): number {
  const exp = Math.floor(Math.log10(x));
  const f = x / 10 ** exp;
  let nf: number;
  if (round) nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
  else nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nf * 10 ** exp;
}

/** Distinct, whole-number ticks: every metric here is a count, so 0.5 or 33.9 never makes sense. */
export function niceTicks(lo: number, hi: number, count: number): number[] {
  lo = Math.floor(lo);
  hi = Math.ceil(hi);
  if (hi <= lo) hi = lo + 1;
  const step = Math.max(1, Math.round(niceNum((hi - lo) / count, false)));
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const out: number[] = [];
  for (let v = start; v <= end; v += step) out.push(v);
  return out;
}

export function logTicks(lo: number, hi: number): number[] {
  const a = Math.floor(Math.log10(Math.max(1, lo)));
  const b = Math.max(a + 1, Math.ceil(Math.log10(Math.max(1, hi))));
  const out: number[] = [];
  for (let p = a; p <= b; p++) {
    out.push(10 ** p);
    if (b - a <= 2 && p < b) {
      out.push(2 * 10 ** p, 5 * 10 ** p);
    }
  }
  return out.sort((x, y) => x - y);
}

/** Drop ticks whose printed label equals the previous one (e.g. 1,100 and 1,150 both "1.1k"). */
export function distinctLabels(ticks: number[]): number[] {
  const out: number[] = [];
  let prev = '';
  for (const t of ticks) {
    const l = tickLabel(t);
    if (l !== prev) out.push(t);
    prev = l;
  }
  return out;
}

/** Drop empty values and sort by time; everything downstream assumes this shape. */
export function prepareSeries(series: ChartSeries[]): Prepared[] {
  return series.map((s) => ({
    key: s.key,
    label: s.label,
    color: s.color,
    type: s.type ?? 'line',
    pts: s.data
      .filter((p) => p.v != null && Number.isFinite(p.v))
      .map((p) => ({ t: dayMs(p.day), day: p.day, v: p.v as number, flag: !!p.flag }))
      .sort((a, b) => a.t - b.t),
  }));
}

/** Value of the latest point at or before `t` (step lookup), or null before the first point. */
export function valueAt(pts: PreparedPoint[], t: number): number | null {
  let lo = 0;
  let hi = pts.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((pts[mid] as PreparedPoint).t <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans < 0 ? null : (pts[ans] as PreparedPoint).v;
}

export interface ChartModel {
  /** Every distinct timestamp across all series, ascending. */
  allT: number[];
  ticks: number[];
  /** Y domain, always equal to the first and last tick. */
  d0: number;
  d1: number;
}

export function buildModel(prepared: Prepared[], scale: 'linear' | 'log', zeroBase: boolean): ChartModel | null {
  const allT = Array.from(new Set(prepared.flatMap((s) => s.pts.map((p) => p.t)))).sort((a, b) => a - b);
  if (allT.length === 0) return null;
  const allV = prepared.flatMap((s) => s.pts.map((p) => p.v));
  const vMax = Math.max(...allV);
  const vMin = Math.min(...allV);
  let ticks: number[];
  if (scale === 'log') {
    const positive = allV.filter((v) => v > 0);
    ticks = distinctLabels(logTicks(positive.length ? Math.min(...positive) : 1, Math.max(1, vMax)));
  } else {
    let lo = zeroBase ? Math.min(0, vMin) : vMin;
    let hi = vMax;
    if (vMax === vMin) {
      // flat (or a single point): give the line some air instead of a degenerate axis
      if (zeroBase) hi = vMax + Math.max(1, Math.round(vMax * 0.1));
      else {
        lo = vMin - 1;
        hi = vMax + 1;
      }
    } else if (!zeroBase) {
      const pad = (hi - lo || 1) * 0.08;
      lo -= pad;
      hi += pad;
    }
    if (vMin >= 0) lo = Math.max(0, lo);
    ticks = distinctLabels(niceTicks(lo, hi, 4));
  }
  return { allT, ticks, d0: ticks[0] as number, d1: ticks[ticks.length - 1] as number };
}

export interface ChartLayout {
  single: boolean;
  tMin: number;
  tMax: number;
  span: number;
  ml: number;
  mt: number;
  /** Plot width and height in px. */
  pw: number;
  ph: number;
  yBase: number;
  X: (t: number) => number;
  Y: (v: number) => number;
}

export function makeLayout(model: ChartModel, width: number, height: number, scale: 'linear' | 'log'): ChartLayout {
  const { allT, ticks, d0, d1 } = model;
  const single = allT.length === 1;
  // a lone snapshot sits in the middle of a one-week window instead of on the y-axis
  const tMin = single ? (allT[0] as number) - 3 * DAY : (allT[0] as number);
  const tMax = single ? (allT[0] as number) + 3 * DAY : (allT[allT.length - 1] as number);
  const span = tMax - tMin;
  const ml = Math.max(...ticks.map((t) => tickLabel(t).length)) * 7 + 12;
  const mr = 14;
  const mt = 10;
  const mb = 26;
  const pw = Math.max(10, width - ml - mr);
  const ph = height - mt - mb;
  const X = (t: number) => ml + ((t - tMin) / span) * pw;
  const Y = (v: number) => {
    if (scale === 'log') {
      const a = Math.log10(d0);
      const b = Math.log10(d1);
      return mt + ph - ((Math.log10(Math.max(v, d0)) - a) / (b - a || 1)) * ph;
    }
    return mt + ph - ((v - d0) / (d1 - d0 || 1)) * ph;
  };
  return { single, tMin, tMax, span, ml, mt, pw, ph, yBase: mt + ph, X, Y };
}

/** Axis date label; long spans switch from "Mar 4" to "Mar ’26". */
export function fmtTick(t: number, spanDays: number): string {
  const d = new Date(t);
  if (spanDays > 150) return `${d.toLocaleDateString(undefined, { timeZone: 'UTC', month: 'short' })} ’${String(d.getUTCFullYear()).slice(2)}`;
  return d.toLocaleDateString(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric' });
}

export type Anchor = 'start' | 'middle' | 'end';

/** Whole-day x ticks; never more labels than fit or than there are days, and never the same label twice. */
export function xTickPositions(allT: number[], layout: Pick<ChartLayout, 'single' | 'tMin' | 'tMax' | 'span' | 'pw'>): Array<{ t: number; anchor: Anchor }> {
  const { single, tMin, tMax, span, pw } = layout;
  if (single) return [{ t: allT[0] as number, anchor: 'middle' }];
  const spanDays = span / DAY;
  const n = Math.max(2, Math.min(7, Math.floor(pw / 80), Math.floor(spanDays) + 1));
  const raw: number[] = [];
  for (let i = 0; i < n; i++) raw.push(Math.round((tMin + (span * i) / (n - 1)) / DAY) * DAY);
  const kept: number[] = [];
  let next = '';
  for (let i = raw.length - 1; i >= 0; i--) {
    const l = fmtTick(raw[i] as number, spanDays);
    if (l !== next) kept.unshift(raw[i] as number);
    next = l;
  }
  return kept.map((t) => ({ t, anchor: t === tMin ? 'start' : t === tMax ? 'end' : 'middle' }));
}

/** Index into `allT` of the timestamp closest to `t`. `allT` must be ascending and non-empty. */
export function nearestIndex(allT: number[], t: number): number {
  let lo = 0;
  let hi = allT.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((allT[mid] as number) <= t) lo = mid;
    else hi = mid;
  }
  const a = allT[lo] as number;
  const b = allT[hi] as number;
  return Math.abs(t - a) <= Math.abs(b - t) ? lo : hi;
}

/** Runs split on `flag` so reconstructed history can be dashed; each run repeats the previous point so lines join up. */
export function runsOf(pts: PreparedPoint[]): Array<{ flag: boolean; pts: PreparedPoint[] }> {
  const runs: Array<{ flag: boolean; pts: PreparedPoint[] }> = [];
  pts.forEach((p, i) => {
    const last = runs[runs.length - 1];
    if (!last || last.flag !== p.flag) {
      const run = { flag: p.flag, pts: [] as PreparedPoint[] };
      if (last && i > 0) run.pts.push(pts[i - 1] as PreparedPoint);
      runs.push(run);
    }
    (runs[runs.length - 1] as (typeof runs)[number]).pts.push(p);
  });
  return runs;
}
