import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { exact, fmtDay } from '../lib/format.ts';
import { buildHeatmap, moveHeatFocus, type HeatCell } from '../lib/heatmap.ts';

const CELL = 11;
const GAP = 3;
const LEFT = 30;
const TOP = 18;

const cellText = (c: HeatCell) => `${exact(c.commits)} commit${c.commits === 1 ? '' : 's'} · ${fmtDay(c.day)}`;

/**
 * Commit calendar as an ARIA grid with a roving tabindex: Tab stops once on the grid, arrow keys move
 * between days (left/right a week, up/down a day), and every cell has a text name, so the numbers are
 * available without a pointer.
 */
export function CommitHeatmap({ days }: { days: Array<{ day: string; commits: number }> }) {
  const scroller = useRef<HTMLDivElement>(null);
  const cellEls = useRef<Array<SVGRectElement | null>>([]);
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);
  const [active, setActive] = useState<number | null>(null);

  const model = useMemo(() => buildHeatmap(days), [days]);
  // cells grouped by weekday so each row is a `row` in the grid; `i` is the chronological index
  const rows = useMemo(() => {
    const out: Array<Array<{ c: HeatCell; i: number }>> = Array.from({ length: 7 }, () => []);
    model?.cells.forEach((c, i) => {
      out[c.row]!.push({ c, i });
    });
    return out;
  }, [model]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: new data is the trigger
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [model]);

  if (!model) return <div className="chart-empty">No commits in the last year.</div>;
  const count = model.cells.length;
  const tabStop = Math.min(active ?? count - 1, count - 1);
  const w = LEFT + model.weeks * (CELL + GAP);
  const h = TOP + 7 * (CELL + GAP);
  const dayNames = [1, 3, 5].map((r) => ({ r, name: new Date(Date.UTC(2023, 0, 1 + r)).toLocaleDateString(undefined, { timeZone: 'UTC', weekday: 'short' }) }));

  const show = (c: HeatCell) =>
    setHover({ x: LEFT + c.col * (CELL + GAP) + CELL / 2, y: TOP + c.row * (CELL + GAP), text: cellText(c) });

  function onCellKey(e: KeyboardEvent<SVGRectElement>, i: number) {
    const next = moveHeatFocus(i, e.key, count);
    if (next < 0) return;
    e.preventDefault();
    setActive(next);
    cellEls.current[next]?.focus();
  }

  return (
    <div>
      <div className="heat-scroll" ref={scroller}>
        <div className="heat-inner" style={{ width: w }}>
          <svg
            width={w}
            height={h}
            role="grid"
            aria-label={`Commit calendar: ${exact(model.total)} commits in the last year. Busiest day ${fmtDay(model.best.day)} with ${exact(model.best.commits)}. Use the arrow keys to move between days.`}
            aria-rowcount={7}
            onPointerLeave={() => setHover(null)}
          >
            {model.months.map((m) => (
              <text key={m.col} className="axis-label" x={LEFT + m.col * (CELL + GAP)} y={10} aria-hidden="true">
                {m.label}
              </text>
            ))}
            {dayNames.map((d) => (
              <text key={d.r} className="axis-label" x={0} y={TOP + d.r * (CELL + GAP) + CELL - 1} aria-hidden="true">
                {d.name}
              </text>
            ))}
            {rows.map((row, r) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: always the seven weekdays, in order
              <g key={r} role="row" aria-rowindex={r + 1}>
                {row.map(({ c, i }) => (
                  <rect
                    key={c.day}
                    ref={(el) => {
                      cellEls.current[i] = el;
                    }}
                    role="gridcell"
                    aria-label={cellText(c)}
                    tabIndex={i === tabStop ? 0 : -1}
                    className={`heat-cell heat-${c.level}`}
                    x={LEFT + c.col * (CELL + GAP)}
                    y={TOP + c.row * (CELL + GAP)}
                    width={CELL}
                    height={CELL}
                    rx={2.5}
                    onPointerEnter={() => show(c)}
                    onFocus={() => {
                      setActive(i);
                      show(c);
                    }}
                    onBlur={() => setHover(null)}
                    onKeyDown={(e) => onCellKey(e, i)}
                  />
                ))}
              </g>
            ))}
          </svg>
          {hover && (
            <div className="tooltip tooltip-pin" style={{ left: hover.x, top: hover.y }} aria-hidden="true">
              {hover.text}
            </div>
          )}
        </div>
      </div>
      <div className="heat-legend" aria-hidden="true">
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <svg key={l} width="12" height="12">
            <rect className={`heat-cell heat-${l}`} width="12" height="12" rx="2.5" />
          </svg>
        ))}
        <span>More</span>
      </div>
    </div>
  );
}
