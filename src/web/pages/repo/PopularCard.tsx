import { useState } from 'react';
import { useApp } from '../../context.tsx';
import { api } from '../../lib/api.ts';
import { fmtDay } from '../../lib/format.ts';
import { useFetch } from '../../lib/hooks.ts';
import { Card, Fetched, Num, Seg } from '../../components/ui.tsx';

type Window = '14d' | 'all';

/** Referrers and popular pages, for GitHub's 14-day window or the archived lifetime. */
export function PopularCard({ id }: { id: number }) {
  const { syncVersion } = useApp();
  const [popRange, setPopRange] = useState<Window>('14d');
  const popular = useFetch(() => Promise.all([api.repoReferrers(id, popRange), api.repoPaths(id, popRange)]), [id, popRange], syncVersion);
  const first = popular.data?.[0];
  // lifetime "unique" is a sum of daily counts; the 14-day window is GitHub's own figure. Read from the
  // selected window, not the data, so the label is right while the other window loads.
  const summed = popRange === 'all';

  return (
    <Card
      title="Referrers and popular content"
      sub={summed ? `Estimated from archived snapshots${first?.since ? ` since ${fmtDay(first.since)}` : ''}` : "GitHub's rolling 14-day window"}
      actions={
        <Seg<Window>
          label="Window"
          small
          value={popRange}
          onChange={setPopRange}
          options={[
            { value: '14d', label: 'Last 14 days' },
            { value: 'all', label: 'Lifetime' },
          ]}
        />
      }
      busy={popular.loading}
    >
      <Fetched f={popular} height={160}>
        {([referrers, paths]) => (
          <div className="grid-2 grid-flush">
            <div>
              <h3>Referrers</h3>
              {referrers.rows.length === 0 ? (
                <p className="muted pad">No referrers in this window.</p>
              ) : (
                <div className="table-wrap" tabIndex={0}>
                  <table className="table table-compact">
                    <thead>
                      <tr>
                        <th scope="col">Source</th>
                        <th scope="col" className="r">
                          Views
                        </th>
                        <th scope="col" className="r" title={summed ? 'Daily uniques added up' : undefined}>
                          Unique
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {referrers.rows.map((r) => (
                        <tr key={r.referrer}>
                          <th scope="row">{r.referrer}</th>
                          <td className="r">
                            <Num v={r.count} />
                          </td>
                          <td className="r">
                            <Num v={r.uniques} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div>
              <h3>Popular pages</h3>
              {paths.rows.length === 0 ? (
                <p className="muted pad">No page views in this window.</p>
              ) : (
                <div className="table-wrap" tabIndex={0}>
                  <table className="table table-compact">
                    <thead>
                      <tr>
                        <th scope="col">Path</th>
                        <th scope="col" className="r">
                          Views
                        </th>
                        <th scope="col" className="r" title={summed ? 'Daily uniques added up' : undefined}>
                          Unique
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {paths.rows.map((r) => (
                        <tr key={r.path}>
                          <th scope="row" className="path-cell">
                            <a href={`https://github.com${r.path}`} target="_blank" rel="noreferrer" title={r.path}>
                              {r.path}
                            </a>
                            {r.title && <div className="cell-sub muted clip">{r.title}</div>}
                          </th>
                          <td className="r">
                            <Num v={r.count} />
                          </td>
                          <td className="r">
                            <Num v={r.uniques} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </Fetched>
    </Card>
  );
}
