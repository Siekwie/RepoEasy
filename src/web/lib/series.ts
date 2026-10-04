import type { MetricPoint, TrafficPoint } from '../../shared/api.ts';
import type { ChartPoint, ChartSeries } from './chart-math.ts';

export function cumulative(pts: ChartPoint[]): ChartPoint[] {
  let sum = 0;
  return pts.map((p) => {
    sum += p.v ?? 0;
    return { day: p.day, v: sum };
  });
}

export function trafficSeries(points: TrafficPoint[], kind: 'views' | 'clones', cumulativeMode: boolean): ChartSeries[] {
  const mk = (key: keyof TrafficPoint): ChartPoint[] => {
    const raw = points.map((p) => ({ day: p.day, v: p[key] as number }));
    return cumulativeMode ? cumulative(raw) : raw;
  };
  if (kind === 'views') {
    return [
      { key: 'views', label: cumulativeMode ? 'Views (running total)' : 'Views', color: 'var(--s1)', type: 'area', data: mk('views') },
      { key: 'uniques', label: cumulativeMode ? 'Unique visitors (running total)' : 'Unique visitors', color: 'var(--s2)', type: 'line', data: mk('uniques') },
    ];
  }
  return [
    { key: 'clones', label: cumulativeMode ? 'Clones (running total)' : 'Clones', color: 'var(--s3)', type: 'area', data: mk('clones') },
    { key: 'cloneUniques', label: cumulativeMode ? 'Unique cloners (running total)' : 'Unique cloners', color: 'var(--s2)', type: 'line', data: mk('cloneUniques') },
  ];
}

export function metricPoints(points: MetricPoint[], key: 'stars' | 'forks' | 'openIssues' | 'openPrs' | 'releaseDownloads', flagBackfilled = false): ChartPoint[] {
  return points.map((p) => ({ day: p.day, v: p[key], flag: flagBackfilled && !!p.backfilled }));
}
