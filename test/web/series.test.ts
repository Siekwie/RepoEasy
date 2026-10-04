import { describe, expect, it } from 'vitest';
import type { MetricPoint, TrafficPoint } from '../../src/shared/api.ts';
import { cumulative, metricPoints, trafficSeries } from '../../src/web/lib/series.ts';

describe('cumulative', () => {
  it('keeps a running total per day', () => {
    const out = cumulative([
      { day: '2024-01-01', v: 3 },
      { day: '2024-01-02', v: 0 },
      { day: '2024-01-03', v: 4 },
    ]);
    expect(out.map((p) => p.v)).toEqual([3, 3, 7]);
    expect(out.map((p) => p.day)).toEqual(['2024-01-01', '2024-01-02', '2024-01-03']);
  });

  it('treats a missing value as zero instead of poisoning the total', () => {
    expect(cumulative([{ day: 'a', v: 2 }, { day: 'b', v: null }, { day: 'c', v: 1 }]).map((p) => p.v)).toEqual([2, 2, 3]);
  });

  it('drops the dashed flag (a total is always solid) and handles empty input', () => {
    expect(cumulative([{ day: 'a', v: 1, flag: true }])[0]).toEqual({ day: 'a', v: 1 });
    expect(cumulative([])).toEqual([]);
  });

  it('does not mutate its input', () => {
    const input = [{ day: 'a', v: 1 }, { day: 'b', v: 2 }];
    cumulative(input);
    expect(input.map((p) => p.v)).toEqual([1, 2]);
  });
});

describe('trafficSeries', () => {
  const pts: TrafficPoint[] = [
    { day: '2024-01-01', views: 10, uniques: 4, clones: 2, cloneUniques: 1 },
    { day: '2024-01-02', views: 5, uniques: 3, clones: 0, cloneUniques: 0 },
  ];

  it('builds views and visitors for the views chart', () => {
    const [views, uniques] = trafficSeries(pts, 'views', false);
    expect(views!.key).toBe('views');
    expect(views!.data.map((p) => p.v)).toEqual([10, 5]);
    expect(uniques!.key).toBe('uniques');
    expect(uniques!.data.map((p) => p.v)).toEqual([4, 3]);
  });

  it('builds clones and cloners for the clones chart', () => {
    const [clones, uniques] = trafficSeries(pts, 'clones', false);
    expect(clones!.data.map((p) => p.v)).toEqual([2, 0]);
    expect(uniques!.data.map((p) => p.v)).toEqual([1, 0]);
  });

  it('accumulates and relabels every series in cumulative mode', () => {
    const [views, uniques] = trafficSeries(pts, 'views', true);
    expect(views!.data.map((p) => p.v)).toEqual([10, 15]);
    expect(uniques!.data.map((p) => p.v)).toEqual([4, 7]);
    expect(views!.label).toContain('running total');
    expect(uniques!.label).toContain('running total');
  });
});

describe('metricPoints', () => {
  const pts: MetricPoint[] = [
    { day: '2024-01-01', stars: 5, forks: 1, watchers: 0, openIssues: 2, openPrs: 0, releaseDownloads: 9, backfilled: true },
    { day: '2024-01-02', stars: 6, forks: 1, watchers: 0, openIssues: 2, openPrs: 1, releaseDownloads: 9, backfilled: false },
  ];

  it('picks one metric', () => {
    expect(metricPoints(pts, 'stars').map((p) => p.v)).toEqual([5, 6]);
    expect(metricPoints(pts, 'openPrs').map((p) => p.v)).toEqual([0, 1]);
  });

  it('flags backfilled days only when asked to', () => {
    expect(metricPoints(pts, 'stars', true).map((p) => p.flag)).toEqual([true, false]);
    expect(metricPoints(pts, 'stars').map((p) => p.flag)).toEqual([false, false]);
  });
});
