import { describe, expect, it } from 'vitest';
import { HEAT_STEP_MAX, HEAT_STEP_MIN, buildHeatmap, heatStep, moveHeatFocus, type HeatDay } from '../../src/web/lib/heatmap.ts';

/** n consecutive days from `start` (UTC), with commit counts from `counts` (cycled). */
function days(start: string, n: number, counts: number[]): HeatDay[] {
  const t0 = Date.parse(`${start}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => ({ day: new Date(t0 + i * 86_400_000).toISOString().slice(0, 10), commits: counts[i % counts.length]! }));
}

describe('buildHeatmap', () => {
  it('is null without data', () => {
    expect(buildHeatmap([])).toBeNull();
  });

  it('puts Sunday on the top row and starts a new column each Sunday', () => {
    // 2024-01-07 is a Sunday
    const m = buildHeatmap(days('2024-01-07', 14, [1]))!;
    expect(m.cells[0]).toMatchObject({ day: '2024-01-07', col: 0, row: 0 });
    expect(m.cells[6]).toMatchObject({ col: 0, row: 6 });
    expect(m.cells[7]).toMatchObject({ day: '2024-01-14', col: 1, row: 0 });
    expect(m.weeks).toBe(2);
  });

  it('pads the first column when the range starts mid-week', () => {
    // 2024-01-10 is a Wednesday (row 3)
    const m = buildHeatmap(days('2024-01-10', 5, [1]))!;
    expect(m.cells[0]).toMatchObject({ col: 0, row: 3 });
    expect(m.cells[3]).toMatchObject({ day: '2024-01-13', col: 0, row: 6 });
    expect(m.cells[4]).toMatchObject({ day: '2024-01-14', col: 1, row: 0 });
    expect(m.weeks).toBe(2);
  });

  it('totals the commits and finds the busiest day', () => {
    const m = buildHeatmap(days('2024-01-07', 4, [2, 0, 9, 1]))!;
    expect(m.total).toBe(12);
    expect(m.best).toEqual({ day: '2024-01-09', commits: 9 });
  });

  it('keeps empty days at level 0 and ranks busy days into 1 to 4', () => {
    const m = buildHeatmap(days('2024-01-07', 8, [0, 1, 2, 3, 4, 5, 6, 7]))!;
    expect(m.cells[0]!.level).toBe(0);
    const levels = m.cells.map((c) => c.level);
    expect(Math.max(...levels)).toBe(4);
    expect(Math.min(...levels.slice(1))).toBe(1);
    // more commits never gets a lower level
    for (let i = 2; i < levels.length; i++) expect(levels[i]!).toBeGreaterThanOrEqual(levels[i - 1]!);
  });

  it('does not divide by zero when nothing was committed', () => {
    const m = buildHeatmap(days('2024-01-07', 10, [0]))!;
    expect(m.cells.every((c) => c.level === 0)).toBe(true);
    expect(m.total).toBe(0);
  });

  it('labels months, at least three columns apart', () => {
    const m = buildHeatmap(days('2024-01-07', 140, [1]))!;
    expect(m.months.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < m.months.length; i++) expect(m.months[i]!.col - m.months[i - 1]!.col).toBeGreaterThanOrEqual(3);
  });
});

describe('moveHeatFocus (arrow keys on the grid)', () => {
  const N = 30;
  it('moves a week left and right, a day up and down', () => {
    expect(moveHeatFocus(15, 'ArrowLeft', N)).toBe(8);
    expect(moveHeatFocus(15, 'ArrowRight', N)).toBe(22);
    expect(moveHeatFocus(15, 'ArrowUp', N)).toBe(14);
    expect(moveHeatFocus(15, 'ArrowDown', N)).toBe(16);
  });

  it('stops at the ends instead of leaving the grid', () => {
    expect(moveHeatFocus(3, 'ArrowLeft', N)).toBe(0);
    expect(moveHeatFocus(0, 'ArrowUp', N)).toBe(0);
    expect(moveHeatFocus(27, 'ArrowRight', N)).toBe(29);
    expect(moveHeatFocus(29, 'ArrowDown', N)).toBe(29);
  });

  it('jumps to the first and last day', () => {
    expect(moveHeatFocus(10, 'Home', N)).toBe(0);
    expect(moveHeatFocus(10, 'End', N)).toBe(29);
  });

  it('returns -1 for keys it does not handle, so Tab and typing still work', () => {
    expect(moveHeatFocus(10, 'Tab', N)).toBe(-1);
    expect(moveHeatFocus(10, 'a', N)).toBe(-1);
  });
});

describe('heatStep (cell pitch that fills the card)', () => {
  it('divides the room between the weeks, in whole pixels', () => {
    expect(heatStep(53 * 18, 53)).toBe(18);
    expect(heatStep(53 * 18 + 40, 53)).toBe(18);
  });

  it('never makes the year wider than the room it was given', () => {
    for (const width of [760, 901, 1040, 1163]) expect(heatStep(width, 53) * 53).toBeLessThanOrEqual(width);
  });

  it('stops shrinking at the smallest readable cell, where the calendar scrolls instead', () => {
    expect(heatStep(300, 53)).toBe(HEAT_STEP_MIN);
  });

  it('stops growing on a very wide card', () => {
    expect(heatStep(4000, 53)).toBe(HEAT_STEP_MAX);
  });

  it('copes with nothing to measure yet', () => {
    expect(heatStep(0, 53)).toBe(HEAT_STEP_MIN);
    expect(heatStep(-34, 53)).toBe(HEAT_STEP_MIN);
    expect(heatStep(800, 0)).toBe(HEAT_STEP_MIN);
  });
});
