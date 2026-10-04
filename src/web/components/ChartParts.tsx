import type { PointerEvent } from 'react';
import { fmtDay } from '../lib/format.ts';
import { DAY, fmtTick, nearestIndex, runsOf, tickLabel, valueAt, xTickPositions, type ChartLayout, type ChartModel, type Prepared } from '../lib/chart-math.ts';

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
  const spanDays = span / DAY;
  const xTicks = xTickPositions(allT, layout);
  const linePath = (pts: Prepared['pts']) => pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join('');

  function indexFromPointer(e: PointerEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    return nearestIndex(allT, tMin + (x / (rect.width || 1)) * span);
  }

  return (
    <svg width={width} height={height} className="chart-svg" role="img" aria-label={props.ariaLabel}>
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
          {fmtTick(t, spanDays)}
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
            // biome-ignore lint/suspicious/noArrayIndexKey: a run has no identity beyond its position in the series
            <path key={`${s.key}-${i}`} d={linePath(r.pts)} className={r.flag ? 'line line-flag' : 'line'} style={{ stroke: s.color }} />
          ))
        ),
      )}
      {cur != null && (
        <g pointerEvents="none">
          <line className="crosshair" x1={X(cur)} x2={X(cur)} y1={mt} y2={yBase} />
          {rows.map(({ s, v }) => v != null && <circle key={s.key} cx={X(cur)} cy={Y(v)} r={4} className="dot" style={{ fill: s.color }} />)}
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
      className="tooltip"
      aria-live="polite"
      style={{ left: props.left, top: props.top, transform: props.flipLeft ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)' }}
    >
      <div className="tooltip-date">{fmtDay(dayOf(props.cur))}</div>
      {props.rows.map(({ s, v }) => (
        <div className="tooltip-row" key={s.key}>
          <span className="tooltip-key" style={{ background: s.color }} aria-hidden="true" />
          <strong>{v == null ? '–' : props.formatValue(v)}</strong>
          <span>{s.label}</span>
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
