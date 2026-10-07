import { useId, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { area, curveMonotoneX, line } from 'd3-shape';
import { compact, exact } from '../lib/format.ts';

export { Chart } from './Chart.tsx';
export { CommitHeatmap } from './Heatmap.tsx';
export type { ChartPoint, ChartSeries } from '../lib/chart-math.ts';

/**
 * `fromZero`: scale from zero and wash the area under the line, for amounts per day (views, clones).
 * Without it the line floats between its own lowest and highest value, which is what a running total
 * such as a star count needs to show any movement at all.
 */
export function Sparkline({ data, label, color = 'var(--s1)', width = 96, height = 26, fromZero = false }: { data: number[]; label: string; color?: string; width?: number; height?: number; fromZero?: boolean }) {
  const uid = useId();
  if (data.length < 2) return <span className="muted" role="img" aria-label={label}>–</span>;
  const lo = fromZero ? Math.min(0, ...data) : Math.min(...data);
  const hi = Math.max(...data);
  const pad = 3.5;
  const sx = (i: number) => pad + (i / (data.length - 1)) * (width - pad * 2);
  const sy = (v: number) => (hi === lo ? height / 2 : height - pad - ((v - lo) / (hi - lo)) * (height - pad * 2));
  const flat = hi === lo;
  const ink = flat && hi === 0 ? 'var(--ink-3)' : color;
  const points = data.map((v, i) => [sx(i), sy(v)] as [number, number]);
  const d = line().curve(curveMonotoneX)(points) ?? '';
  const fill = area().y0(height).curve(curveMonotoneX)(points) ?? '';
  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={label}>
      <title>{label}</title>
      <defs>
        <linearGradient id={`${uid}s`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" className="area-from" style={{ stopColor: ink }} />
          <stop offset="1" className="area-to" style={{ stopColor: ink }} />
        </linearGradient>
      </defs>
      {fromZero && !flat && <path d={fill} fill={`url(#${uid}s)`} />}
      <path d={d} className="spark-line" style={{ stroke: ink }} />
      <circle cx={sx(data.length - 1)} cy={sy(data[data.length - 1] as number)} r={2.75} className="spark-dot" style={{ fill: ink }} />
    </svg>
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

/** Ranked rows, each lying on a soft bar as long as its share of the largest value. */
export function BarList({ rows, empty = 'Nothing here yet.', color = 'var(--s1)', valueLabel }: { rows: BarRow[]; empty?: string; color?: string; valueLabel?: string }) {
  if (rows.length === 0) return <p className="muted pad">{empty}</p>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="barlist" style={{ '--bar': color } as CSSProperties}>
      {rows.map((r) => (
        <li key={r.key} title={r.title ?? `${exact(r.value)}${valueLabel ? ` ${valueLabel}` : ''}`}>
          <span className="barlist-fill" style={{ width: `${Math.max(1, (r.value / max) * 100)}%` }} aria-hidden="true" />
          <span className="barlist-label">{r.to ? <Link to={r.to}>{r.label}</Link> : r.label}</span>
          <span className="barlist-value num">
            {compact(r.value)}
            {r.secondary && <span className="barlist-secondary"> · {r.secondary}</span>}
          </span>
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
  const max = Math.max(...items.map((i) => i.bytes));
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
      <ul className="barlist langlist">
        {items.map((i) => (
          <li key={i.name} style={{ '--bar': i.color } as CSSProperties}>
            <span className="barlist-fill" style={{ width: `${Math.max(1, (i.bytes / max) * 100)}%` }} aria-hidden="true" />
            <span className="barlist-label">
              <span className="lang-dot" style={{ background: i.color }} aria-hidden="true" />
              {i.name}
            </span>
            <span className="barlist-value num">{label(i.bytes)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
