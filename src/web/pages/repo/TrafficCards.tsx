import { useMemo } from 'react';
import type { Range, RepoDetail, TrafficSeries } from '../../../shared/api.ts';
import { UNIQUES_NOTE, rangeLong } from '../../lib/format.ts';
import type { FetchState } from '../../lib/hooks.ts';
import { trafficSeries } from '../../lib/series.ts';
import { Chart } from '../../components/charts.tsx';
import { Card, Fetched } from '../../components/ui.tsx';

/** Views and clones cards, or the explanation when there is no traffic to show for this repository. */
export function TrafficCards({ repo: d, traffic, range, cumulative }: { repo: RepoDetail; traffic: FetchState<TrafficSeries | null>; range: Range; cumulative: boolean }) {
  const followed = d.relation === 'followed';
  const t = traffic.data;
  const charts = useMemo(
    () => ({
      views: t ? trafficSeries(t.points, 'views', cumulative) : [],
      clones: t ? trafficSeries(t.points, 'clones', cumulative) : [],
    }),
    [t, cumulative],
  );

  if (!d.canPush) {
    return (
      <Card title="Traffic" className="span-2">
        <p className="note">
          {d.host === 'codeberg'
            ? 'Codeberg does not record views or clones, so there is no traffic to archive. Stars, forks, issues and releases are tracked below.'
            : followed
              ? 'Views and clones are only visible to people with push access to a repository, so they are not available for followed repositories. Stars, forks, issues and releases are tracked below.'
              : "GitHub only reports views and clones to people with push access, and your account doesn't have it for this repository. Stars, forks, issues and releases are still tracked below."}
        </p>
      </Card>
    );
  }
  const sub = cumulative ? 'Running total over the period' : 'Per day (UTC)';
  const note = cumulative ? UNIQUES_NOTE : undefined;
  return (
    <>
      <Card title="Views and unique visitors" sub={sub} busy={traffic.loading}>
        <Fetched f={traffic} height={240}>
          {() => <Chart series={charts.views} note={note} ariaLabel={`Views and unique visitors for ${d.fullName}, ${rangeLong(range)}`} table empty="No traffic archived for this period yet." />}
        </Fetched>
      </Card>
      <Card title="Clones and unique cloners" sub={sub} busy={traffic.loading}>
        <Fetched f={traffic} height={240}>
          {() => <Chart series={charts.clones} note={note} ariaLabel={`Clones and unique cloners for ${d.fullName}, ${rangeLong(range)}`} table empty="No clones archived for this period yet." />}
        </Fetched>
      </Card>
    </>
  );
}
