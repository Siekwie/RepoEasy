import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useSize } from '../lib/hooks.ts';
import { compact, dayMs, exact, fmtDay } from '../lib/format.ts';

const DAY = 86_400_000;
const tickFmt = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 });
/** Axis label: like `compact` but with a second decimal so neighbouring ticks (16.85k) stay distinct. */
const tickLabel = (n: number) => tickFmt.format(n).replace(/(\d)K$/, '$1k');

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

function niceNum(x: number, round: boolean): number {
  const exp = Math.floor(Math.log10(x));
  const f = x / 10 ** exp;
  let nf: number;
  if (round) nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
  else nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nf * 10 ** exp;
}

/** Distinct, whole-number ticks: every metric here is a count, so 0.5 or 33.9 never makes sense. */
function niceTicks(lo: number, hi: number, count: number): number[] {
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

function logTicks(lo: number, hi: number): number[] {
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
function distinctLabels(ticks: number[]): number[] {
  const out: number[] = [];
  let prev = '';
  for (const t of ticks) {
    const l = tickLabel(t);
    if (l !== prev) out.push(t);
    prev = l;
  }
  return out;
}

interface Prepared {
  key: string;
  label: string;
  color: string;
  type: 'area' | 'line';
  pts: Array<{ t: number; day: string; v: number; flag: boolean }>;
}

function valueAt(pts: Prepared['pts'], t: number): number | null {
  let lo = 0;
  let hi = pts.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((pts[mid] as Prepared['pts'][number]).t <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans < 0 ? null : (pts[ans] as Prepared['pts'][number]).v;
}

export function Chart(props: {
  series: ChartSeries[];
  height?: number;
  scale?: 'linear' | 'log';
  /** Anchor the y axis at zero (default true). */
  zeroBase?: boolean;
  ariaLabel: string;
  note?: ReactNode;
  formatValue?: (n: number) => string;
  /** Show a "Table" toggle with the underlying values. */
  table?: boolean;
  empty?: ReactNode;
}) {
  const { height = 240, scale = 'linear', zeroBase = true, ariaLabel, formatValue = exact } = props;
  const [wrapRef, width] = useSize<HTMLDivElement>();
  const [idx, setIdx] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  const prepared = useMemo<Prepared[]>(
    () =>
      props.series.map((s) => ({
        key: s.key,
        label: s.label,
        color: s.color,
        type: s.type ?? 'line',
        pts: s.data
          .filter((p) => p.v != null && Number.isFinite(p.v))
          .map((p) => ({ t: dayMs(p.day), day: p.day, v: p.v as number, flag: !!p.flag }))
          .sort((a, b) => a.t - b.t),
      })),
    [props.series],
  );

  const model = useMemo(() => {
    const allT = Array.from(new Set(prepared.flatMap((s) => s.pts.map((p) => p.t)))).sort((a, b) => a - b);
    if (allT.length === 0) return null;
    const allV = prepared.flatMap((s) => s.pts.map((p) => p.v));
    const vMax = Math.max(...allV);
    const vMin = Math.min(...allV);
    let ticks: number[];
    let d0: number;
    let d1: number;
    if (scale === 'log') {
      const positive = allV.filter((v) => v > 0);
      ticks = distinctLabels(logTicks(positive.length ? Math.min(...positive) : 1, Math.max(1, vMax)));
      d0 = ticks[0] as number;
      d1 = ticks[ticks.length - 1] as number;
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
      d0 = ticks[0] as number;
      d1 = ticks[ticks.length - 1] as number;
    }
    return { allT, ticks, d0, d1 };
  }, [prepared, scale, zeroBase]);

  if (!model) return <div className="chart-empty">{props.empty ?? 'No data for this period yet.'}</div>;

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
  const yBase = mt + ph;

  const spanDays = span / DAY;
  const fmtTick = (t: number) => {
    const d = new Date(t);
    if (spanDays > 150) return `${d.toLocaleDateString(undefined, { timeZone: 'UTC', month: 'short' })} ’${String(d.getUTCFullYear()).slice(2)}`;
    return d.toLocaleDateString(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric' });
  };
  const xTicks = (() => {
    if (single) return [{ t: allT[0] as number, anchor: 'middle' as const }];
    // whole days only; never more labels than days, and never the same label twice
    const n = Math.max(2, Math.min(7, Math.floor(pw / 96), Math.floor(spanDays) + 1));
    const raw: number[] = [];
    for (let i = 0; i < n; i++) raw.push(Math.round((tMin + (span * i) / (n - 1)) / DAY) * DAY);
    const kept: number[] = [];
    let next = '';
    for (let i = raw.length - 1; i >= 0; i--) {
      const l = fmtTick(raw[i] as number);
      if (l !== next) kept.unshift(raw[i] as number);
      next = l;
    }
    return kept.map((t) => ({ t, anchor: (t === tMin ? 'start' : t === tMax ? 'end' : 'middle') as 'start' | 'middle' | 'end' }));
  })();
  const singleCaption = (() => {
    if (!single) return null;
    const day = new Date(allT[0] as number).toISOString().slice(0, 10);
    return day === new Date().toISOString().slice(0, 10)
      ? 'Tracking started today. The line fills in as daily snapshots arrive.'
      : `Only one snapshot so far (${fmtDay(day)}). The line fills in as daily snapshots arrive.`;
  })();

  function indexFromPointer(e: PointerEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const t = tMin + (x / (rect.width || 1)) * span;
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

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const last = allT.length - 1;
    if (e.key === 'ArrowLeft') setIdx((i) => Math.max(0, (i ?? last + 1) - 1));
    else if (e.key === 'ArrowRight') setIdx((i) => Math.min(last, (i ?? -1) + 1));
    else if (e.key === 'Home') setIdx(0);
    else if (e.key === 'End') setIdx(last);
    else if (e.key === 'Escape') setIdx(null);
    else return;
    e.preventDefault();
  }

  const linePath = (pts: Prepared['pts']) => pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join('');
  const hasFlags = prepared.some((s) => s.pts.some((p) => p.flag));

  // runs split on `flag` so reconstructed history can be dashed
  const runsOf = (pts: Prepared['pts']) => {
    const runs: Array<{ flag: boolean; pts: Prepared['pts'] }> = [];
    pts.forEach((p, i) => {
      const last = runs[runs.length - 1];
      if (!last || last.flag !== p.flag) {
        const run = { flag: p.flag, pts: [] as Prepared['pts'] };
        if (last && i > 0) run.pts.push(pts[i - 1] as Prepared['pts'][number]);
        runs.push(run);
      }
      (runs[runs.length - 1] as (typeof runs)[number]).pts.push(p);
    });
    return runs;
  };

  const cur = idx != null ? allT[Math.min(idx, allT.length - 1)] : undefined;
  const crossX = cur != null ? X(cur) : 0;
  const rows = cur != null ? prepared.map((s) => ({ s, v: valueAt(s.pts, cur) })) : [];
  const flipLeft = crossX > width * 0.55;

  return (
    <div className="chart-block">
      {prepared.length > 1 && (
        <ul className="legend" aria-label="Legend">
          {prepared.map((s) => (
            <li key={s.key}>
              <span className="legend-key" style={{ background: s.color }} aria-hidden="true" />
              {s.label}
            </li>
          ))}
        </ul>
      )}
      <div
        className="chart"
        ref={wrapRef}
        style={{ height }}
        tabIndex={0}
        role="group"
        aria-label={`${ariaLabel}. Use the left and right arrow keys to read values.`}
        onKeyDown={onKey}
        onFocus={(e) => {
          if (idx == null && e.target === e.currentTarget && !e.currentTarget.matches(':hover')) setIdx(allT.length - 1);
        }}
        onBlur={() => setIdx(null)}
      >
        {width > 0 && (
          <svg width={width} height={height} className="chart-svg" role="img" aria-label={ariaLabel}>
            {ticks.map((t) => (
              <g key={t}>
                <line className="grid" x1={ml} x2={ml + pw} y1={Y(t)} y2={Y(t)} />
                <text className="axis-label" x={ml - 8} y={Y(t)} textAnchor="end" dominantBaseline="central">
                  {tickLabel(t)}
                </text>
              </g>
            ))}
            <line className="axis" x1={ml} x2={ml + pw} y1={yBase} y2={yBase} />
            {xTicks.map(({ t, anchor }) => (
              <text key={t} className="axis-label" x={X(t)} y={height - 6} textAnchor={anchor}>
                {fmtTick(t)}
              </text>
            ))}
            {prepared.map(
              (s) =>
                s.type === 'area' &&
                s.pts.length > 1 && (
                  <path
                    key={`a-${s.key}`}
                    d={`${linePath(s.pts)}L${X((s.pts[s.pts.length - 1] as Prepared['pts'][number]).t).toFixed(1)},${yBase}L${X((s.pts[0] as Prepared['pts'][number]).t).toFixed(1)},${yBase}Z`}
                    style={{ fill: s.color }}
                    className="area"
                  />
                ),
            )}
            {prepared.map((s) =>
              s.pts.length === 1 ? (
                <circle key={s.key} cx={X((s.pts[0] as Prepared['pts'][number]).t)} cy={Y((s.pts[0] as Prepared['pts'][number]).v)} r={4.5} className="dot" style={{ fill: s.color }} />
              ) : (
                runsOf(s.pts).map((r, i) => (
                  <path key={`${s.key}-${i}`} d={linePath(r.pts)} className={r.flag ? 'line line-flag' : 'line'} style={{ stroke: s.color }} />
                ))
              ),
            )}
            {cur != null && (
              <g pointerEvents="none">
                <line className="crosshair" x1={crossX} x2={crossX} y1={mt} y2={yBase} />
                {rows.map(
                  ({ s, v }) => v != null && <circle key={s.key} cx={crossX} cy={Y(v)} r={4} className="dot" style={{ fill: s.color }} />,
                )}
              </g>
            )}
            <rect
              className="chart-hit"
              x={ml}
              y={mt}
              width={pw}
              height={ph}
              onPointerMove={(e) => setIdx(indexFromPointer(e))}
              onPointerDown={(e) => setIdx(indexFromPointer(e))}
              onPointerLeave={(e) => e.pointerType === 'mouse' && setIdx(null)}
            />
          </svg>
        )}
        {cur != null && (
          <div
            className="tooltip"
            aria-live="polite"
            style={{ left: crossX, top: mt, transform: flipLeft ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)' }}
          >
            <div className="tooltip-date">{fmtDay(new Date(cur).toISOString().slice(0, 10))}</div>
            {rows.map(({ s, v }) => (
              <div className="tooltip-row" key={s.key}>
                <span className="tooltip-key" style={{ background: s.color }} aria-hidden="true" />
                <strong>{v == null ? '–' : formatValue(v)}</strong>
                <span>{s.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {singleCaption && <p className="chart-caption muted">{singleCaption}</p>}
      {(props.note || hasFlags || props.table) && (
        <div className="chart-foot">
          <span className="muted">
            {props.note}
            {hasFlags && (
              <>
                {props.note ? ' ' : ''}
                <svg width="22" height="8" aria-hidden="true" className="flag-key">
                  <line x1="1" x2="21" y1="4" y2="4" />
                </svg>
                Dashed: reconstructed from GitHub's star history.
              </>
            )}
          </span>
          {props.table && (
            <button type="button" className="btn btn-sm btn-quiet" aria-expanded={showTable} onClick={() => setShowTable((v) => !v)}>
              {showTable ? 'Hide table' : 'Show as table'}
            </button>
          )}
        </div>
      )}
      {showTable && (
        <div className="table-wrap chart-table" tabIndex={0}>
          <table className="table table-compact">
            <thead>
              <tr>
                <th scope="col">Day</th>
                {prepared.map((s) => (
                  <th scope="col" key={s.key} className="r">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...allT]
                .reverse()
                .slice(0, 500)
                .map((t) => (
                  <tr key={t}>
                    <th scope="row">{fmtDay(new Date(t).toISOString().slice(0, 10))}</th>
                    {prepared.map((s) => {
                      const v = valueAt(s.pts, t);
                      return (
                        <td key={s.key} className="r num">
                          {v == null ? '–' : formatValue(v)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function Sparkline({ data, label, color = 'var(--s1)', width = 96, height = 26 }: { data: number[]; label: string; color?: string; width?: number; height?: number }) {
  if (data.length < 2) return <span className="muted" aria-label={label}>–</span>;
  const lo = Math.min(...data);
  const hi = Math.max(...data);
  const pad = 3;
  const sx = (i: number) => pad + (i / (data.length - 1)) * (width - pad * 2);
  const sy = (v: number) => (hi === lo ? height / 2 : height - pad - ((v - lo) / (hi - lo)) * (height - pad * 2));
  const d = data.map((v, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join('');
  const flat = hi === lo && hi === 0;
  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={label}>
      <title>{label}</title>
      <path d={d} className="spark-line" style={{ stroke: flat ? 'var(--ink-3)' : color }} />
      <circle cx={sx(data.length - 1)} cy={sy(data[data.length - 1] as number)} r={2.5} style={{ fill: flat ? 'var(--ink-3)' : color }} />
    </svg>
  );
}

export function CommitHeatmap({ days }: { days: Array<{ day: string; commits: number }> }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);
  const CELL = 11;
  const GAP = 3;
  const left = 30;
  const top = 18;

  const model = useMemo(() => {
    if (days.length === 0) return null;
    const first = new Date(`${days[0]!.day}T00:00:00Z`);
    const pad = first.getUTCDay();
    const nz = days.map((d) => d.commits).filter((c) => c > 0).sort((a, b) => a - b);
    const q = (p: number) => nz[Math.min(nz.length - 1, Math.floor(p * nz.length))] ?? 0;
    const t1 = q(0.25);
    const t2 = q(0.5);
    const t3 = q(0.75);
    const level = (c: number) => (c <= 0 ? 0 : c <= t1 ? 1 : c <= t2 ? 2 : c <= t3 ? 3 : 4);
    const weeks = Math.ceil((days.length + pad) / 7);
    const cells = days.map((d, i) => ({ ...d, col: Math.floor((i + pad) / 7), row: (i + pad) % 7, level: level(d.commits) }));
    const months: Array<{ col: number; label: string }> = [];
    let prevMonth = -1;
    let lastCol = -10;
    for (const c of cells) {
      if (c.row !== 0 && !(c.col === 0)) continue;
      const m = new Date(`${c.day}T00:00:00Z`).getUTCMonth();
      if (m !== prevMonth) {
        if (c.col - lastCol >= 3) {
          months.push({ col: c.col, label: new Date(`${c.day}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: 'UTC', month: 'short' }) });
          lastCol = c.col;
        }
        prevMonth = m;
      }
    }
    const total = days.reduce((a, d) => a + d.commits, 0);
    const best = days.reduce((a, d) => (d.commits > a.commits ? d : a), days[0]!);
    return { cells, weeks, months, total, best };
  }, [days]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [model]);

  if (!model) return <div className="chart-empty">No commits in the last year.</div>;
  const w = left + model.weeks * (CELL + GAP);
  const h = top + 7 * (CELL + GAP);
  const dayNames = [1, 3, 5].map((r) => ({ r, name: new Date(Date.UTC(2023, 0, 1 + r)).toLocaleDateString(undefined, { timeZone: 'UTC', weekday: 'short' }) }));

  return (
    <div>
      <div className="heat-scroll" ref={scroller}>
        <div className="heat-inner" style={{ width: w }}>
          <svg
            width={w}
            height={h}
            role="img"
            aria-label={`Commit calendar: ${exact(model.total)} commits in the last year. Busiest day ${fmtDay(model.best.day)} with ${exact(model.best.commits)}.`}
            onPointerLeave={() => setHover(null)}
          >
            {model.months.map((m) => (
              <text key={m.col} className="axis-label" x={left + m.col * (CELL + GAP)} y={10}>
                {m.label}
              </text>
            ))}
            {dayNames.map((d) => (
              <text key={d.r} className="axis-label" x={0} y={top + d.r * (CELL + GAP) + CELL - 1}>
                {d.name}
              </text>
            ))}
            {model.cells.map((c) => (
              <rect
                key={c.day}
                className={`heat-cell heat-${c.level}`}
                x={left + c.col * (CELL + GAP)}
                y={top + c.row * (CELL + GAP)}
                width={CELL}
                height={CELL}
                rx={2.5}
                onPointerEnter={() =>
                  setHover({
                    x: left + c.col * (CELL + GAP) + CELL / 2,
                    y: top + c.row * (CELL + GAP),
                    text: `${exact(c.commits)} commit${c.commits === 1 ? '' : 's'} · ${fmtDay(c.day)}`,
                  })
                }
              />
            ))}
          </svg>
          {hover && (
            <div className="tooltip tooltip-pin" style={{ left: hover.x, top: hover.y }}>
              {hover.text}
            </div>
          )}
        </div>
      </div>
      <div className="heat-legend" aria-hidden="true">
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <svg key={l} width="12" height="12">
            <rect className={`heat-cell heat-${l}`} width="12" height="12" rx="2.5" />
          </svg>
        ))}
        <span>More</span>
      </div>
    </div>
  );
}

export interface BarRow {
  key: string | number;
  label: ReactNode;
  value: number;
  secondary?: string;
  to?: string;
  title?: string;
}

export function BarList({ rows, empty = 'Nothing here yet.', color = 'var(--s1)', valueLabel }: { rows: BarRow[]; empty?: string; color?: string; valueLabel?: string }) {
  if (rows.length === 0) return <p className="muted pad">{empty}</p>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="barlist">
      {rows.map((r) => (
        <li key={r.key} title={r.title ?? `${exact(r.value)}${valueLabel ? ' ' + valueLabel : ''}`}>
          <div className="barlist-top">
            <span className="barlist-label">{r.to ? <Link to={r.to}>{r.label}</Link> : r.label}</span>
            <span className="barlist-value num">
              {compact(r.value)}
              {r.secondary && <span className="muted"> · {r.secondary}</span>}
            </span>
          </div>
          <div className="barlist-track" aria-hidden="true">
            <div className="barlist-fill" style={{ width: `${Math.max(1.5, (r.value / max) * 100)}%`, background: color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function LangBar({ languages }: { languages: Array<{ name: string; color: string | null; bytes: number }> }) {
  const sorted = [...languages].filter((l) => l.bytes > 0).sort((a, b) => b.bytes - a.bytes);
  const total = sorted.reduce((a, l) => a + l.bytes, 0);
  if (total === 0) return <p className="muted pad">No language data yet.</p>;
  const head = sorted.slice(0, 7);
  const rest = sorted.slice(7);
  const items = head.map((l) => ({ name: l.name, color: l.color ?? 'var(--ink-3)', bytes: l.bytes }));
  if (rest.length) items.push({ name: 'Other', color: 'var(--ink-3)', bytes: rest.reduce((a, l) => a + l.bytes, 0) });
  const label = (b: number) => {
    const p = (b / total) * 100;
    return p < 0.1 ? '<0.1%' : `${p < 10 ? p.toFixed(1) : Math.round(p)}%`;
  };
  return (
    <div>
      <div className="langbar" role="img" aria-label={`Languages: ${items.map((i) => `${i.name} ${label(i.bytes)}`).join(', ')}`}>
        {items.map((i) => (
          <span key={i.name} style={{ flexGrow: i.bytes, background: i.color }} title={`${i.name} ${label(i.bytes)}`} />
        ))}
      </div>
      <ul className="langlist">
        {items.map((i) => (
          <li key={i.name}>
            <span className="lang-dot" style={{ background: i.color }} aria-hidden="true" />
            {i.name} <span className="muted">{label(i.bytes)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
