import type { Day, Range } from '../../shared/api.ts';

const exactFmt = new Intl.NumberFormat();
const compactFmt = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

export function exact(n: number | null | undefined): string {
  return n == null || Number.isNaN(n) ? '–' : exactFmt.format(n);
}

/** 1234 -> 1.2k */
export function compact(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '–';
  return compactFmt.format(n).replace(/(\d)K$/, '$1k');
}

export function signed(n: number): string {
  if (n === 0) return '0';
  return (n > 0 ? '+' : '−') + compact(Math.abs(n));
}

export function pct(n: number): string {
  return `${Math.round(n)}%`;
}

export function dayToDate(day: Day): Date {
  return new Date(`${day}T00:00:00Z`);
}

export function dayMs(day: Day): number {
  return Date.parse(`${day}T00:00:00Z`);
}

export function fmtDay(day: Day | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  if (!day) return '–';
  const d = dayToDate(day.length > 10 ? day.slice(0, 10) : day);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString(undefined, { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric', ...opts });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '–';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 31536000],
  ['month', 2592000],
  ['week', 604800],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
];

export function relative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '–';
  const diff = Math.round((t - now) / 1000);
  const abs = Math.abs(diff);
  if (abs < 45) return 'just now';
  for (const [unit, secs] of UNITS) {
    if (abs >= secs) return rtf.format(Math.round(diff / secs), unit);
  }
  return rtf.format(Math.round(diff / 60), 'minute');
}

export function pctChange(cur: number, prev: number): number | null {
  if (prev === 0) return cur === 0 ? 0 : null;
  return ((cur - prev) / prev) * 100;
}

export const RANGES: Array<{ value: Range; label: string; long: string }> = [
  { value: '14d', label: '14d', long: 'last 14 days' },
  { value: '30d', label: '30d', long: 'last 30 days' },
  { value: '90d', label: '90d', long: 'last 90 days' },
  { value: '1y', label: '1y', long: 'last year' },
  { value: 'all', label: 'All', long: 'all time' },
];

export function parseRange(v: string | null, fallback: Range = '30d'): Range {
  return RANGES.some((r) => r.value === v) ? (v as Range) : fallback;
}

export function rangeLong(r: Range): string {
  return RANGES.find((x) => x.value === r)?.long ?? r;
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${u[i]}`;
}

export function parseRepoInput(raw: string): string {
  let s = raw.trim();
  s = s.replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/\.git$/i, '').replace(/[?#].*$/, '');
  s = s.replace(/\/+$/, '');
  const parts = s.split('/');
  return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : s;
}
