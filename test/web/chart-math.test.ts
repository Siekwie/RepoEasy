import { describe, expect, it } from 'vitest';
import {
  DAY,
  buildModel,
  distinctLabels,
  logTicks,
  makeLayout,
  nearestIndex,
  niceNum,
  niceTicks,
  prepareSeries,
  runsOf,
  valueAt,
  xTickPositions,
  type ChartSeries,
} from '../../src/web/lib/chart-math.ts';

const series = (data: Array<[string, number | null]>, extra: Partial<ChartSeries> = {}): ChartSeries => ({
  key: 'a',
  label: 'A',
  color: 'red',
  data: data.map(([day, v]) => ({ day, v })),
  ...extra,
});

describe('niceNum', () => {
  it('rounds to 1, 2, 5 or 10 times a power of ten', () => {
    expect(niceNum(1.2, true)).toBe(1);
    expect(niceNum(2, true)).toBe(2);
    expect(niceNum(4, true)).toBe(5);
    expect(niceNum(8, true)).toBe(10);
    expect(niceNum(1.2, false)).toBe(2);
    expect(niceNum(25, false)).toBe(50);
    expect(niceNum(0.03, false)).toBeCloseTo(0.05);
  });
});

describe('niceTicks', () => {
  it('gives whole-number steps that cover the range', () => {
    expect(niceTicks(0, 100, 4)).toEqual([0, 50, 100]);
    expect(niceTicks(0, 10, 4)).toEqual([0, 5, 10]);
    expect(niceTicks(0, 1234, 4)).toEqual([0, 500, 1000, 1500]);
  });

  it('never steps below 1, since every metric is a count', () => {
    expect(niceTicks(0, 1, 4)).toEqual([0, 1]);
    expect(niceTicks(0.2, 0.9, 4)).toEqual([0, 1]);
    for (const t of niceTicks(0, 3, 10)) expect(Number.isInteger(t)).toBe(true);
  });

  it('widens a degenerate range instead of returning one tick', () => {
    expect(niceTicks(3, 3, 4)).toEqual([3, 4]);
    expect(niceTicks(0, 0, 4)).toEqual([0, 1]);
  });

  it('handles negative lower bounds and aligns ticks to the step', () => {
    expect(niceTicks(-50, 120, 4)).toEqual([-50, 0, 50, 100, 150]);
    const t = niceTicks(37, 912, 4);
    expect(t[0]! <= 37).toBe(true);
    expect(t[t.length - 1]! >= 912).toBe(true);
    const step = t[1]! - t[0]!;
    for (let i = 1; i < t.length; i++) expect(t[i]! - t[i - 1]!).toBe(step);
  });
});

describe('logTicks', () => {
  it('uses decades for wide ranges and adds 2 and 5 for narrow ones', () => {
    expect(logTicks(1, 1000)).toEqual([1, 10, 100, 1000]);
    expect(logTicks(1, 50)).toEqual([1, 2, 5, 10, 20, 50, 100]);
  });

  it('clamps non-positive input to 1', () => {
    expect(logTicks(0, 0)).toEqual([1, 2, 5, 10]);
  });
});

describe('distinctLabels', () => {
  it('drops ticks that would print the same label as their neighbour', () => {
    expect(distinctLabels([5, 5, 6])).toEqual([5, 6]);
    expect(distinctLabels([])).toEqual([]);
  });
});

describe('prepareSeries', () => {
  it('drops empty points, sorts by time and defaults the type to line', () => {
    const [p] = prepareSeries([series([['2024-01-03', 3], ['2024-01-01', 1], ['2024-01-02', null]])]);
    expect(p!.type).toBe('line');
    expect(p!.pts.map((x) => x.day)).toEqual(['2024-01-01', '2024-01-03']);
    expect(p!.pts[0]!.t).toBe(Date.UTC(2024, 0, 1));
  });

  it('keeps the dashed flag per point', () => {
    const [p] = prepareSeries([{ ...series([]), data: [{ day: '2024-01-01', v: 1, flag: true }, { day: '2024-01-02', v: 2 }] }]);
    expect(p!.pts.map((x) => x.flag)).toEqual([true, false]);
  });
});

describe('valueAt', () => {
  const [p] = prepareSeries([series([['2024-01-02', 10], ['2024-01-04', 20]])]);
  const t = (d: number) => Date.UTC(2024, 0, d);
  it('steps: the latest point at or before t', () => {
    expect(valueAt(p!.pts, t(1))).toBeNull();
    expect(valueAt(p!.pts, t(2))).toBe(10);
    expect(valueAt(p!.pts, t(3))).toBe(10);
    expect(valueAt(p!.pts, t(4))).toBe(20);
    expect(valueAt(p!.pts, t(9))).toBe(20);
  });
  it('is null for an empty series', () => {
    expect(valueAt([], t(1))).toBeNull();
  });
});

describe('buildModel', () => {
  const model = (s: ChartSeries[], scale: 'linear' | 'log' = 'linear', zeroBase = true) => buildModel(prepareSeries(s), scale, zeroBase);

  it('is null when nothing can be drawn', () => {
    expect(model([])).toBeNull();
    expect(model([series([['2024-01-01', null]])])).toBeNull();
  });

  it('anchors the y axis at zero and spans the data', () => {
    const m = model([series([['2024-01-01', 12], ['2024-01-02', 95]])])!;
    expect(m.d0).toBe(0);
    expect(m.d1).toBeGreaterThanOrEqual(95);
    expect(m.ticks[0]).toBe(m.d0);
    expect(m.ticks[m.ticks.length - 1]).toBe(m.d1);
    expect(m.allT).toHaveLength(2);
  });

  it('merges timestamps across series', () => {
    const m = model([series([['2024-01-01', 1], ['2024-01-02', 2]]), series([['2024-01-02', 5], ['2024-01-03', 6]], { key: 'b' })])!;
    expect(m.allT).toHaveLength(3);
  });

  it('gives a flat series some air', () => {
    const m = model([series([['2024-01-01', 7], ['2024-01-02', 7]])])!;
    expect(m.d1).toBeGreaterThan(7);
    const z = model([series([['2024-01-01', 0], ['2024-01-02', 0]])])!;
    expect(z.d1).toBeGreaterThan(z.d0);
  });

  it('can float the axis off zero for slowly growing counts', () => {
    const m = model([series([['2024-01-01', 1000], ['2024-01-02', 1010]])], 'linear', false)!;
    expect(m.d0).toBeGreaterThan(900);
    expect(m.d0).toBeLessThanOrEqual(1000);
    expect(m.d1).toBeGreaterThanOrEqual(1010);
  });

  it('never goes negative for non-negative data', () => {
    const m = model([series([['2024-01-01', 1], ['2024-01-02', 3]])], 'linear', false)!;
    expect(m.d0).toBeGreaterThanOrEqual(0);
  });

  it('builds decade ticks on a log scale', () => {
    const m = model([series([['2024-01-01', 3], ['2024-01-02', 4000]])], 'log')!;
    expect(m.d0).toBeLessThanOrEqual(3);
    expect(m.d1).toBeGreaterThanOrEqual(4000);
    expect(m.ticks).toContain(1000);
  });
});

describe('makeLayout', () => {
  const m = buildModel(prepareSeries([series([['2024-01-01', 0], ['2024-01-11', 100]])]), 'linear', true)!;
  const L = makeLayout(m, 600, 240, 'linear');

  it('maps the first and last day to the plot edges', () => {
    expect(L.X(m.allT[0]!)).toBeCloseTo(L.ml);
    expect(L.X(m.allT[1]!)).toBeCloseTo(L.ml + L.pw);
  });

  it('maps the y domain to the plot top and bottom, higher values higher up', () => {
    expect(L.Y(m.d0)).toBeCloseTo(L.yBase);
    expect(L.Y(m.d1)).toBeCloseTo(L.mt);
    expect(L.Y(60)).toBeLessThan(L.Y(30));
  });

  it('keeps a minimum plot width on a tiny container', () => {
    expect(makeLayout(m, 0, 240, 'linear').pw).toBe(10);
  });

  it('centres a lone snapshot in a one-week window', () => {
    const one = buildModel(prepareSeries([series([['2024-01-05', 5]])]), 'linear', true)!;
    const l = makeLayout(one, 600, 240, 'linear');
    expect(l.single).toBe(true);
    expect(l.span).toBe(6 * DAY);
    expect(l.X(one.allT[0]!)).toBeCloseTo(l.ml + l.pw / 2);
  });

  it('log scale: each decade is the same height and values below the domain clamp to the base', () => {
    const lm = buildModel(prepareSeries([series([['2024-01-01', 1], ['2024-01-02', 1000]])]), 'log', true)!;
    const l = makeLayout(lm, 600, 240, 'log');
    const dec = l.Y(1) - l.Y(10);
    expect(l.Y(10) - l.Y(100)).toBeCloseTo(dec);
    expect(l.Y(100) - l.Y(1000)).toBeCloseTo(dec);
    expect(l.Y(0)).toBeCloseTo(l.Y(1));
  });
});

describe('xTickPositions', () => {
  const layoutFor = (days: number, width = 600) => {
    const rows: Array<[string, number]> = [['2024-01-01', 1], [new Date(Date.UTC(2024, 0, 1 + days)).toISOString().slice(0, 10), 2]];
    const model = buildModel(prepareSeries([series(rows)]), 'linear', true)!;
    return { model, layout: makeLayout(model, width, 240, 'linear') };
  };

  it('puts one centred tick on a lone snapshot', () => {
    const one = buildModel(prepareSeries([series([['2024-01-05', 5]])]), 'linear', true)!;
    const l = makeLayout(one, 600, 240, 'linear');
    expect(xTickPositions(one.allT, l)).toEqual([{ t: one.allT[0], anchor: 'middle' }]);
  });

  it('anchors the first tick at the start and the last at the end', () => {
    const { model, layout } = layoutFor(30);
    const ticks = xTickPositions(model.allT, layout);
    expect(ticks[0]!.anchor).toBe('start');
    expect(ticks[ticks.length - 1]!.anchor).toBe('end');
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(ticks.length).toBeLessThanOrEqual(7);
  });

  it('never shows more ticks than days', () => {
    const { model, layout } = layoutFor(2);
    expect(xTickPositions(model.allT, layout).length).toBeLessThanOrEqual(3);
  });

  it('thins ticks on a narrow plot', () => {
    const wide = xTickPositions(layoutFor(60, 900).model.allT, layoutFor(60, 900).layout).length;
    const narrow = xTickPositions(layoutFor(60, 220).model.allT, layoutFor(60, 220).layout).length;
    expect(narrow).toBeLessThan(wide);
  });

  it('only lands on whole days', () => {
    const { model, layout } = layoutFor(37);
    for (const { t } of xTickPositions(model.allT, layout)) expect(t % DAY).toBe(0);
  });
});

describe('nearestIndex', () => {
  const t = [0, 10, 20, 100];
  it('picks the closest timestamp', () => {
    expect(nearestIndex(t, -5)).toBe(0);
    expect(nearestIndex(t, 4)).toBe(0);
    expect(nearestIndex(t, 6)).toBe(1);
    expect(nearestIndex(t, 19)).toBe(2);
    expect(nearestIndex(t, 70)).toBe(3);
    expect(nearestIndex(t, 5000)).toBe(3);
  });
  it('works with a single point', () => {
    expect(nearestIndex([42], 1)).toBe(0);
  });
  it('prefers the earlier point on a tie', () => {
    expect(nearestIndex([0, 10], 5)).toBe(0);
  });
});

describe('runsOf', () => {
  const pts = (flags: boolean[]) => flags.map((flag, i) => ({ t: i, day: String(i), v: i, flag }));

  it('returns one run when nothing is flagged', () => {
    const runs = runsOf(pts([false, false, false]));
    expect(runs).toHaveLength(1);
    expect(runs[0]!.pts).toHaveLength(3);
  });

  it('splits on flag changes and repeats the boundary point so the line stays connected', () => {
    const runs = runsOf(pts([true, true, false, false]));
    expect(runs.map((r) => r.flag)).toEqual([true, false]);
    expect(runs[0]!.pts.map((p) => p.t)).toEqual([0, 1]);
    expect(runs[1]!.pts.map((p) => p.t)).toEqual([1, 2, 3]);
  });

  it('is empty for no points', () => {
    expect(runsOf([])).toEqual([]);
  });
});
