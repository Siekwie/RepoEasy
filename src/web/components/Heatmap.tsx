import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { exact, fmtDay } from '../lib/format.ts';
import { buildHeatmap, heatStep, moveHeatFocus, type HeatCell } from '../lib/heatmap.ts';
import { useSize } from '../lib/hooks.ts';

const LEFT = 34;
const TOP = 20;

const cellText = (c: HeatCell) => `${exact(c.commits)} commit${c.commits === 1 ? '' : 's'} · ${fmtDay(c.day)}`;

/**
 * Commit calendar as an ARIA grid with a roving tabindex: Tab stops once on the grid, arrow keys move
 * between days (left/right a week, up/down a day), and every cell has a text name, so the numbers are
 * available without a pointer.
 */
export function CommitHeatmap({ days }: { days: Array<{ day: string; commits: number }> }) {
  const scroller = useRef<HTMLDivElement>(null);
  const cellEls = useRef<Array<SVGRectElement | null>>([]);
  const [wrapRef, wrapWidth] = useSize<HTMLDivElement>();
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

  // the pitch follows the card's width, so the year fills it; below the minimum it scrolls instead
  const step = heatStep(wrapWidth - LEFT, model?.weeks ?? 0);
  const gap = step >= 18 ? 4 : 3;
  const cell = step - gap;

  // biome-ignore lint/correctness/useExhaustiveDependencies: new data or a new size is the trigger
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [model, step]);

  if (!model) return <div className="chart-empty">No commits in the last year.</div>;
  const count = model.cells.length;
  const tabStop = Math.min(active ?? count - 1, count - 1);
  const w = LEFT + model.weeks * step - gap;
  const h = TOP + 7 * step - gap;
  const dayNames = [1, 3, 5].map((r) => ({ r, name: new Date(Date.UTC(2023, 0, 1 + r)).toLocaleDateString(undefined, { timeZone: 'UTC', weekday: 'short' }) }));

  const show = (c: HeatCell) => setHover({ x: LEFT + c.col * step + cell / 2, y: TOP + c.row * step, text: cellText(c) });

  function onCellKey(e: KeyboardEvent<SVGRectElement>, i: number) {
    const next = moveHeatFocus(i, e.key, count);
    if (next < 0) return;
    e.preventDefault();
    setActive(next);
    cellEls.current[next]?.focus();
  }

  return (
    <div ref={wrapRef}>
      <div className="heat-scroll" ref={scroller}>
        <div className="heat-inner" style={{ width: w }}>
          {wrapWidth > 0 && (
            <svg
              width={w}
              height={h}
              role="grid"
              aria-label={`Commit calendar: ${exact(model.total)} commits in the last year. Busiest day ${fmtDay(model.best.day)} with ${exact(model.best.commits)}. Use the arrow keys to move between days.`}
              aria-rowcount={7}
              onPointerLeave={() => setHover(null)}
            >
              {model.months.map((m) => {
                // a month that starts in the last columns would run off the edge: end it there instead
                const tight = LEFT + m.col * step > w - 28;
                return (
                  <text key={m.col} className="axis-label" x={tight ? w : LEFT + m.col * step} y={11} textAnchor={tight ? 'end' : 'start'} aria-hidden="true">
                    {m.label}
                  </text>
                );
              })}
              {dayNames.map((d) => (
                <text key={d.r} className="axis-label" x={0} y={TOP + d.r * step + cell / 2} dominantBaseline="central" aria-hidden="true">
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
                      x={LEFT + c.col * step}
                      y={TOP + c.row * step}
                      width={cell}
                      height={cell}
                      rx={cell >= 15 ? 3.5 : 2.5}
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
          )}
          {hover && (
            <div className="tooltip tooltip-pin" style={{ left: hover.x, top: hover.y }} aria-hidden="true">
              {hover.text}
            </div>
          )}
        </div>
      </div>
      <div className="heat-foot">
        <p className="muted">
          <strong className="num">{exact(model.total)}</strong> commit{model.total === 1 ? '' : 's'}
          {model.total > 0 && (
            <>
              {' '}
              · busiest day {fmtDay(model.best.day, { year: undefined })} with <span className="num">{exact(model.best.commits)}</span>
            </>
          )}
        </p>
        <div className="heat-legend" aria-hidden="true">
          <span>Less</span>
          {[0, 1, 2, 3, 4].map((l) => (
            <svg key={l} width="12" height="12">
              <rect className={`heat-cell heat-${l}`} width="12" height="12" rx="3" />
            </svg>
          ))}
          <span>More</span>
        </div>
      </div>
    </div>
  );
}
