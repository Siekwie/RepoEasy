import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useSize } from '../lib/hooks.ts';
import { exact, fmtDay } from '../lib/format.ts';
import { buildModel, makeLayout, prepareSeries, valueAt, type ChartSeries } from '../lib/chart-math.ts';
import { ChartPlot, ChartTable, ChartTooltip } from './ChartParts.tsx';
import { Icon } from './Icon.tsx';

/** A faint flat line with a dot: "this is where a chart will be". */
function EmptyMark() {
  return (
    <svg width="72" height="28" viewBox="0 0 72 28" aria-hidden="true" className="chart-empty-mark">
      <path d="M2 22C14 22 16 10 28 12s12 10 22 6 12-12 20-12" />
    </svg>
  );
}

export function Chart(props: {
  series: ChartSeries[];
  height?: number;
  scale?: 'linear' | 'log';
  /** Anchor the y axis at zero (default true). */
  zeroBase?: boolean;
  ariaLabel: string;
  note?: ReactNode;
  formatValue?: (n: number) => string;
  /** Show a "Table" toggle with the underlying values. */
  table?: boolean;
  empty?: ReactNode;
}) {
  const { height = 240, scale = 'linear', zeroBase = true, ariaLabel, formatValue = exact } = props;
  const [wrapRef, width] = useSize<HTMLDivElement>();
  const [idx, setIdx] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  const prepared = useMemo(() => prepareSeries(props.series), [props.series]);
  const model = useMemo(() => buildModel(prepared, scale, zeroBase), [prepared, scale, zeroBase]);

  if (!model) {
    return (
      <div className="chart-empty" style={{ minHeight: height }}>
        <EmptyMark />
        <p>{props.empty ?? 'No data for this period yet.'}</p>
      </div>
    );
  }

  const { allT } = model;
  const layout = makeLayout(model, width, height, scale);
  const hasFlags = prepared.some((s) => s.pts.some((p) => p.flag));
  const singleCaption = (() => {
    if (!layout.single) return null;
    const day = new Date(allT[0] as number).toISOString().slice(0, 10);
    return day === new Date().toISOString().slice(0, 10)
      ? 'Tracking started today. The line fills in as daily snapshots arrive.'
      : `Only one snapshot so far (${fmtDay(day)}). The line fills in as daily snapshots arrive.`;
  })();

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const last = allT.length - 1;
    if (e.key === 'ArrowLeft') setIdx((i) => Math.max(0, (i ?? last + 1) - 1));
    else if (e.key === 'ArrowRight') setIdx((i) => Math.min(last, (i ?? -1) + 1));
    else if (e.key === 'Home') setIdx(0);
    else if (e.key === 'End') setIdx(last);
    else if (e.key === 'Escape') setIdx(null);
    else return;
    e.preventDefault();
  }

  const cur = idx != null ? allT[Math.min(idx, allT.length - 1)] : undefined;
  const rows = cur != null ? prepared.map((s) => ({ s, v: valueAt(s.pts, cur) })) : [];
  const crossX = cur != null ? layout.X(cur) : 0;

  return (
    <div className="chart-block">
      {prepared.length > 1 && (
        <ul className="legend" aria-label="Legend">
          {prepared.map((s) => (
            <li key={s.key}>
              <span className={`legend-key legend-${s.type}`} style={{ background: s.color }} aria-hidden="true" />
              {s.label}
            </li>
          ))}
        </ul>
      )}
      <div
        className="chart"
        ref={wrapRef}
        style={{ height }}
        tabIndex={0}
        role="group"
        aria-label={`${ariaLabel}. Use the left and right arrow keys to read values.`}
        onKeyDown={onKey}
        onFocus={(e) => {
          if (idx == null && e.target === e.currentTarget && !e.currentTarget.matches(':hover')) setIdx(allT.length - 1);
        }}
        onBlur={() => setIdx(null)}
      >
        {width > 0 && (
          <ChartPlot
            prepared={prepared}
            model={model}
            layout={layout}
            width={width}
            height={height}
            ariaLabel={ariaLabel}
            cur={cur}
            rows={rows}
            onPick={setIdx}
            onLeave={() => setIdx(null)}
          />
        )}
        {cur != null && <ChartTooltip cur={cur} left={crossX} top={layout.mt} flipLeft={crossX > width * 0.55} rows={rows} formatValue={formatValue} />}
      </div>
      {singleCaption && <p className="chart-caption muted">{singleCaption}</p>}
      {(props.note || hasFlags || props.table) && (
        <div className="chart-foot">
          <span className="muted">
            {props.note}
            {hasFlags && (
              <>
                {props.note ? ' ' : ''}
                <svg width="22" height="8" aria-hidden="true" className="flag-key">
                  <line x1="1" x2="21" y1="4" y2="4" />
                </svg>
                Dashed: reconstructed from GitHub's star history.
              </>
            )}
          </span>
          {props.table && (
            <button type="button" className="chart-toggle" aria-expanded={showTable} onClick={() => setShowTable((v) => !v)}>
              <Icon name="table" size={13} />
              {showTable ? 'Hide table' : 'Show as table'}
            </button>
          )}
        </div>
      )}
      {showTable && <ChartTable prepared={prepared} allT={allT} formatValue={formatValue} />}
    </div>
  );
}
