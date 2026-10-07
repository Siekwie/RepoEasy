import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../context.tsx';
import { api } from '../lib/api.ts';
import { UNIQUES_HINT, fmtDay, rangeLong } from '../lib/format.ts';
import { useFetch, useInterval, useRangeParam, useTitle } from '../lib/hooks.ts';
import { trafficSeries } from '../lib/series.ts';
import { BarList, Chart, CommitHeatmap, LangBar, Sparkline } from '../components/charts.tsx';
import { EventList } from '../components/feeds.tsx';
import { RangeSelect } from '../components/RangeSelect.tsx';
import { Card, Empty, ErrorBox, Fetched, FirstSync, PageHead, PctDelta, Seg, SignedDelta, Skeleton, Tile } from '../components/ui.tsx';

export function Overview() {
  useTitle('Overview');
  const { sync, syncVersion } = useApp();
  const [range, setRange] = useRangeParam();
  const ov = useFetch(() => api.overview(range), [range], syncVersion);
  const ev = useFetch(() => api.events(8), [], syncVersion);
  const [tab, setTab] = useState<'views' | 'clones'>('views');

  const data = ov.data;
  const firstSync = !!data && data.repoCount === 0 && !!sync?.running;
  useInterval(() => ov.reload(), 6000, firstSync);

  const traffic = useMemo(() => (data ? trafficSeries(data.traffic.points, tab, false) : []), [data, tab]);
  const stars = useMemo(
    () => (data ? [{ key: 'stars', label: 'Total stars', color: 'var(--s7)', type: 'line' as const, data: data.starSeries.map((p) => ({ day: p.day, v: p.stars })) }] : []),
    [data],
  );

  // one small trend per tile, in the colour the same metric has in the chart below
  const trend = (key: 'views' | 'uniques' | 'clones' | 'cloneUniques', label: string, color: string) =>
    data && data.traffic.points.length > 2 ? (
      <Sparkline data={data.traffic.points.map((p) => p[key])} label={`${label} per day, ${rangeLong(range)}`} color={color} width={92} height={32} fromZero />
    ) : undefined;

  const sub = data ? `${data.repoCount} repositories · ${data.trackedCount} tracked · ${data.followedCount} followed` : 'Across all your repositories';

  return (
    <>
      <PageHead title="Overview" sub={sub} actions={<RangeSelect value={range} onChange={setRange} />} />
      {ov.error && <ErrorBox error={ov.error} onRetry={ov.reload} stale={!!data} />}
      {!data && !ov.error && (
        <>
          <Skeleton height={120} />
          <Skeleton height={300} />
        </>
      )}
      {data && firstSync && <FirstSync step={sync?.step ?? null} />}
      {data && !firstSync && data.repoCount === 0 && (
        <Empty
          title="No repositories yet"
          action={
            <Link className="btn btn-primary" to="/repos">
              Go to repositories
            </Link>
          }
        >
          Run a sync to pull in your repositories, then choose which ones to track.
        </Empty>
      )}
      {data && data.repoCount > 0 && (
        <div className={ov.loading ? 'is-refreshing' : ''}>
          <section className="kpi-group" aria-labelledby="kp-life">
            <div className="kpi-head">
              <h2 id="kp-life">Lifetime</h2>
              <p className="muted">
                {data.trafficSince ? (
                  <>
                    Archived by RepoEasy since <strong>{fmtDay(data.trafficSince)}</strong>. GitHub itself only keeps 14 days.
                  </>
                ) : (
                  <>Nothing archived yet. Track a repository to start building history.</>
                )}
              </p>
            </div>
            <div className="kpis">
              <Tile label="Views" value={data.lifetime.views} sub="all tracked repos" />
              <Tile label="Unique visitors" value={data.lifetime.uniques} sub="sum of daily uniques" hint={UNIQUES_HINT} />
              <Tile label="Clones" value={data.lifetime.clones} sub={`${data.lifetime.cloneUniques.toLocaleString()} unique cloners, daily sum`} />
              <Tile
                label="Stars"
                value={data.stars}
                sub={<SignedDelta value={data.starsDelta} suffix={rangeLong(range)} />}
              />
            </div>
          </section>

          <section className="kpi-group" aria-labelledby="kp-range">
            <div className="kpi-head">
              <h2 id="kp-range">{range === 'all' ? 'All time' : `Last ${rangeLong(range).replace('last ', '')}`}</h2>
              <p className="muted">{data.traffic.previous ? 'Change compares with the period just before.' : 'No earlier period to compare with.'}</p>
            </div>
            <div className="kpis">
              <Tile
                label="Views"
                value={data.traffic.totals.views}
                trend={trend('views', 'Views', 'var(--s1)')}
                sub={<PctDelta cur={data.traffic.totals.views} prev={data.traffic.previous?.views} />}
              />
              <Tile
                label="Unique visitors"
                value={data.traffic.totals.uniques}
                hint={UNIQUES_HINT}
                trend={trend('uniques', 'Unique visitors', 'var(--s2)')}
                sub={<PctDelta cur={data.traffic.totals.uniques} prev={data.traffic.previous?.uniques} />}
              />
              <Tile
                label="Clones"
                value={data.traffic.totals.clones}
                trend={trend('clones', 'Clones', 'var(--s3)')}
                sub={<PctDelta cur={data.traffic.totals.clones} prev={data.traffic.previous?.clones} />}
              />
              <Tile
                label="Unique cloners"
                value={data.traffic.totals.cloneUniques}
                hint={UNIQUES_HINT}
                trend={trend('cloneUniques', 'Unique cloners', 'var(--s2)')}
                sub={<PctDelta cur={data.traffic.totals.cloneUniques} prev={data.traffic.previous?.cloneUniques} />}
              />
            </div>
          </section>

          <Card
            title="Traffic"
            sub="Daily, summed across tracked repositories (UTC days)"
            actions={
              <Seg<'views' | 'clones'>
                label="Traffic metric"
                small
                value={tab}
                onChange={setTab}
                options={[
                  { value: 'views', label: 'Views' },
                  { value: 'clones', label: 'Clones' },
                ]}
              />
            }
          >
            <Chart
              series={traffic}
              height={260}
              ariaLabel={`Daily ${tab === 'views' ? 'views and unique visitors' : 'clones and unique cloners'}, ${rangeLong(range)}`}
              table
              empty="No traffic archived for this period yet."
            />
          </Card>

          <Card title="Stars over time" sub="Total across your repositories">
            <Chart series={stars} zeroBase={false} height={220} ariaLabel="Total stars across all repositories over time" table empty="Star history will appear after the first sync." />
          </Card>

          <div className="grid-2">
            <Card title="Top repositories by views" sub={rangeLong(range)}>
              <BarList
                rows={data.topByViews.map((r) => ({ key: r.id, label: r.fullName, value: r.views, secondary: `${r.uniques.toLocaleString()} visitors`, title: `${r.views.toLocaleString()} views, ${r.uniques.toLocaleString()} visitors (daily uniques added up)`, to: `/repos/${r.id}` }))}
                empty="No views in this period."
                valueLabel="views"
              />
            </Card>
            <Card title="Top repositories by clones" sub={rangeLong(range)}>
              <BarList
                color="var(--s3)"
                rows={data.topByClones.map((r) => ({ key: r.id, label: r.fullName, value: r.clones, secondary: `${r.cloneUniques.toLocaleString()} cloners`, to: `/repos/${r.id}` }))}
                empty="No clones in this period."
                valueLabel="clones"
              />
            </Card>
            <Card title="Top referrers" sub="Where visitors come from">
              <BarList
                color="var(--s2)"
                rows={data.topReferrers.map((r) => ({ key: r.referrer, label: r.referrer, value: r.count, secondary: `${r.uniques.toLocaleString()} unique`, title: `${r.count.toLocaleString()} views, ${r.uniques.toLocaleString()} unique (daily uniques added up)` }))}
                empty="No referrers recorded yet."
                valueLabel="views"
              />
            </Card>
            <Card title="Languages" sub="By code size across your repositories">
              <LangBar languages={data.languages} />
            </Card>
          </div>

          <Card title="Commit calendar" sub="Commits per day across your repositories, last 12 months">
            <CommitHeatmap days={data.commitCalendar} />
          </Card>

          <Card
            title="Latest events"
            actions={
              <Link className="btn btn-sm btn-quiet" to="/activity">
                All activity
              </Link>
            }
          >
            <Fetched f={ev} height={100}>
              {(e) => <EventList events={e} />}
            </Fetched>
          </Card>
        </div>
      )}
    </>
  );
}
