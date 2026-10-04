/** Pure layout for the commit calendar (weeks as columns, Sunday on top). */
export interface HeatDay {
  day: string;
  commits: number;
}
export interface HeatCell extends HeatDay {
  col: number;
  row: number;
  /** 0 (none) to 4 (busiest quartile). */
  level: number;
}
export interface HeatModel {
  cells: HeatCell[];
  weeks: number;
  months: Array<{ col: number; label: string }>;
  total: number;
  best: HeatDay;
}

export function buildHeatmap(days: HeatDay[]): HeatModel | null {
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
}

/** Roving-tabindex target after an arrow key: a week per left/right, a day per up/down. -1 for keys that don't move. */
export function moveHeatFocus(index: number, key: string, count: number): number {
  const last = count - 1;
  switch (key) {
    case 'ArrowLeft':
      return Math.max(0, index - 7);
    case 'ArrowRight':
      return Math.min(last, index + 7);
    case 'ArrowUp':
      return Math.max(0, index - 1);
    case 'ArrowDown':
      return Math.min(last, index + 1);
    case 'Home':
      return 0;
    case 'End':
      return last;
    default:
      return -1;
  }
}
