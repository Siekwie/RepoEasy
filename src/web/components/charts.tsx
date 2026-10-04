import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { compact, exact } from '../lib/format.ts';

export { Chart } from './Chart.tsx';
export { CommitHeatmap } from './Heatmap.tsx';
export type { ChartPoint, ChartSeries } from '../lib/chart-math.ts';

export function Sparkline({ data, label, color = 'var(--s1)', width = 96, height = 26 }: { data: number[]; label: string; color?: string; width?: number; height?: number }) {
  if (data.length < 2) return <span className="muted" role="img" aria-label={label}>–</span>;
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
        <li key={r.key} title={r.title ?? `${exact(r.value)}${valueLabel ? ` ${valueLabel}` : ''}`}>
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
