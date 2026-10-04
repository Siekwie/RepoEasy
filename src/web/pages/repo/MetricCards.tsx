import { useMemo, useState } from 'react';
import type { Range, RepoDetail } from '../../../shared/api.ts';
import { useApp } from '../../context.tsx';
import { api } from '../../lib/api.ts';
import { useFetch } from '../../lib/hooks.ts';
import { metricPoints } from '../../lib/series.ts';
import { Chart } from '../../components/charts.tsx';
import { Card, Fetched, Seg } from '../../components/ui.tsx';

/** Stars, forks, issues and release downloads over time, all from one metrics fetch. */
export function MetricCards({ repo: d, range }: { repo: RepoDetail; range: Range }) {
  const { syncVersion } = useApp();
  const [starScale, setStarScale] = useState<'linear' | 'log'>('linear');
  const metrics = useFetch(() => api.repoMetrics(d.id, range), [d.id, range], syncVersion);

  const pts = metrics.data?.points;
  const stars = useMemo(() => [{ key: 'stars', label: 'Stars', color: 'var(--s7)', type: 'line' as const, data: pts ? metricPoints(pts, 'stars', true) : [] }], [pts]);
  const forks = useMemo(() => [{ key: 'forks', label: 'Forks', color: 'var(--s6)', type: 'line' as const, data: pts ? metricPoints(pts, 'forks') : [] }], [pts]);
  const issues = useMemo(
    () => [
      { key: 'issues', label: 'Open issues', color: 'var(--s2)', type: 'line' as const, data: pts ? metricPoints(pts, 'openIssues') : [] },
      { key: 'prs', label: 'Open pull requests', color: 'var(--s7)', type: 'line' as const, data: pts ? metricPoints(pts, 'openPrs') : [] },
    ],
    [pts],
  );
  const downloads = useMemo(
    () => [{ key: 'dl', label: 'Release downloads (total)', color: 'var(--s3)', type: 'area' as const, data: pts ? metricPoints(pts, 'releaseDownloads') : [] }],
    [pts],
  );

  return (
    <>
      <Card
        title="Stars"
        sub={d.host === 'codeberg' ? 'Recorded daily since it was followed' : d.starHistoryComplete ? 'Full history' : 'Older history is still being backfilled'}
        busy={metrics.loading}
        actions={
          <Seg<'linear' | 'log'>
            label="Stars scale"
            small
            value={starScale}
            onChange={setStarScale}
            options={[
              { value: 'linear', label: 'Linear' },
              { value: 'log', label: 'Log' },
            ]}
          />
        }
      >
        <Fetched f={metrics} height={240}>
          {() => <Chart series={stars} scale={starScale} zeroBase={false} ariaLabel={`Stars for ${d.fullName} over time`} table empty="No star history yet." />}
        </Fetched>
      </Card>
      <Card title="Forks" busy={metrics.loading}>
        <Fetched f={metrics} height={240}>
          {() => <Chart series={forks} zeroBase={false} ariaLabel={`Forks for ${d.fullName} over time`} table empty="No fork history yet." />}
        </Fetched>
      </Card>
      <Card title="Open issues and pull requests" busy={metrics.loading}>
        <Fetched f={metrics} height={240}>
          {() => <Chart series={issues} ariaLabel={`Open issues and pull requests for ${d.fullName} over time`} table empty="No issue history yet." />}
        </Fetched>
      </Card>
      <Card title="Release downloads" sub="Cumulative, all releases" busy={metrics.loading}>
        <Fetched f={metrics} height={240}>
          {() => <Chart series={downloads} ariaLabel={`Cumulative release downloads for ${d.fullName}`} table empty="No release downloads recorded." />}
        </Fetched>
      </Card>
    </>
  );
}
