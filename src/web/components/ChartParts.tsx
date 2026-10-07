import { useId, type PointerEvent } from 'react';
import { area, curveMonotoneX, line } from 'd3-shape';
import { fmtDay } from '../lib/format.ts';
import { DAY, fmtTick, nearestIndex, runsOf, tickLabel, valueAt, xTickPositions, type ChartLayout, type ChartModel, type Prepared, type PreparedPoint } from '../lib/chart-math.ts';

export interface ChartRow {
  s: Prepared;
  v: number | null;
}

const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);

/** The SVG itself: grid, axes, series, crosshair and the transparent hit area. */
export function ChartPlot(props: {
  prepared: Prepared[];
  model: ChartModel;
  layout: ChartLayout;
  width: number;
  height: number;
  ariaLabel: string;
  cur: number | undefined;
  rows: ChartRow[];
  onPick: (i: number) => void;
  onLeave: () => void;
}) {
  const { prepared, model, layout, width, height, cur, rows } = props;
  const { ticks, allT } = model;
  const { ml, mt, pw, ph, yBase, X, Y, tMin, span } = layout;
  const uid = useId();
  const spanDays = span / DAY;
  const xTicks = xTickPositions(allT, layout);
  // Monotone cubic: a smooth curve through every point that never rises above or dips below the
  // values next to it, so a peak in the drawing is always a peak in the data.
  const linePath = line<PreparedPoint>()
    .x((p) => X(p.t))
    .y((p) => Y(p.v))
    .curve(curveMonotoneX);
  const areaPath = area<PreparedPoint>()
    .x((p) => X(p.t))
    .y0(yBase)
    .y1((p) => Y(p.v))
    .curve(curveMonotoneX);
  // new data wipes in from the left; a resize or a hover does not replay it
  const dataKey = prepared.map((s) => `${s.key}:${s.pts.length}:${s.pts[0]?.t}:${s.pts[s.pts.length - 1]?.t}`).join('|');

  function indexFromPointer(e: PointerEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    return nearestIndex(allT, tMin + (x / (rect.width || 1)) * span);
  }

  return (
    <svg width={width} height={height} className="chart-svg" role="img" aria-label={props.ariaLabel}>
      <defs>
        {prepared.map(
          (s, i) =>
            s.type === 'area' && (
              <linearGradient key={s.key} id={`${uid}a${i}`} gradientUnits="userSpaceOnUse" x1={0} x2={0} y1={mt} y2={yBase}>
                <stop offset="0" className="area-from" style={{ stopColor: s.color }} />
                <stop offset="1" className="area-to" style={{ stopColor: s.color }} />
              </linearGradient>
            ),
        )}
      </defs>
      {ticks.map((t) => (
        <g key={t}>
          <line className="grid" x1={ml} x2={ml + pw} y1={Y(t)} y2={Y(t)} />
          <text className="axis-label axis-y" x={ml - 10} y={Y(t)} textAnchor="end" dominantBaseline="central">
            {tickLabel(t)}
          </text>
        </g>
      ))}
      <line className="axis" x1={ml} x2={ml + pw} y1={yBase} y2={yBase} />
      {xTicks.map(({ t, anchor }) => (
        <text key={t} className="axis-label" x={X(t)} y={height - 6} textAnchor={anchor}>
          {fmtTick(t, spanDays)}
        </text>
      ))}
      <g key={dataKey} className="chart-series">
        {prepared.map((s, i) => s.type === 'area' && s.pts.length > 1 && <path key={s.key} d={areaPath(s.pts) ?? ''} fill={`url(#${uid}a${i})`} />)}
        {prepared.map((s) => {
          const last = s.pts[s.pts.length - 1];
          if (!last) return null;
          if (s.pts.length === 1) return <circle key={s.key} cx={X(last.t)} cy={Y(last.v)} r={4.5} className="dot" style={{ fill: s.color }} />;
          return (
            <g key={s.key}>
              {runsOf(s.pts).map((r, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a run has no identity beyond its position in the series
                <path key={i} d={linePath(r.pts) ?? ''} className={r.flag ? 'line line-flag' : 'line'} style={{ stroke: s.color }} />
              ))}
              {/* where the series stands today */}
              <circle cx={X(last.t)} cy={Y(last.v)} r={3.5} className="dot dot-end" style={{ fill: s.color }} />
            </g>
          );
        })}
      </g>
      {cur != null && (
        <g pointerEvents="none">
          <line className="crosshair" x1={X(cur)} x2={X(cur)} y1={mt} y2={yBase} />
          {rows.map(({ s, v }) => v != null && <circle key={s.key} cx={X(cur)} cy={Y(v)} r={4.5} className="dot" style={{ fill: s.color }} />)}
        </g>
      )}
      <rect
        className="chart-hit"
        x={ml}
        y={mt}
        width={pw}
        height={ph}
        onPointerMove={(e) => props.onPick(indexFromPointer(e))}
        onPointerDown={(e) => props.onPick(indexFromPointer(e))}
        onPointerLeave={(e) => e.pointerType === 'mouse' && props.onLeave()}
      />
    </svg>
  );
}

export function ChartTooltip(props: { cur: number; left: number; top: number; flipLeft: boolean; rows: ChartRow[]; formatValue: (n: number) => string }) {
  return (
    <div
      className="tooltip tooltip-chart"
      aria-live="polite"
      style={{ transform: `translate(${Math.round(props.left)}px, ${props.top}px) translateX(${props.flipLeft ? 'calc(-100% - 14px)' : '14px'})` }}
    >
      <div className="tooltip-date">{fmtDay(dayOf(props.cur), { weekday: 'short' })}</div>
      {props.rows.map(({ s, v }) => (
        <div className="tooltip-row" key={s.key}>
          <span className="tooltip-key" style={{ background: s.color }} aria-hidden="true" />
          <span className="tooltip-label">{s.label}</span>
          <strong>{v == null ? '–' : props.formatValue(v)}</strong>
        </div>
      ))}
    </div>
  );
}

/** Underlying values as a table (newest first, capped), for screen readers and exact numbers. */
export function ChartTable({ prepared, allT, formatValue }: { prepared: Prepared[]; allT: number[]; formatValue: (n: number) => string }) {
  return (
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
                <th scope="row">{fmtDay(dayOf(t))}</th>
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
  );
}
