import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApp } from '../context.tsx';
import { ApiException, api } from '../lib/api.ts';
import { UNIQUES_HINT, fmtDay } from '../lib/format.ts';
import { useFetch, useTitle } from '../lib/hooks.ts';
import { metricPoints, trafficSeries } from '../lib/series.ts';
import { BarList, Chart } from '../components/charts.tsx';
import { Icon, Logo } from '../components/Icon.tsx';
import { Card, ErrorBox, LangDot, Skeleton, ThemeToggle, Tile } from '../components/ui.tsx';

export function PublicShare() {
  const { owner = '', repo = '' } = useParams();
  const { me } = useApp();
  const q = useFetch(() => api.publicRepo(owner, repo), [owner, repo]);
  const d = q.data;
  useTitle(d ? d.fullName : `${owner}/${repo}`);

  const views = useMemo(() => (d ? trafficSeries(d.traffic.points, 'views', false) : []), [d]);
  const clones = useMemo(() => (d ? trafficSeries(d.traffic.points, 'clones', false) : []), [d]);
  const stars = useMemo(
    () => [{ key: 'stars', label: 'Stars', color: 'var(--s7)', type: 'line' as const, data: d ? metricPoints(d.metrics.points, 'stars', true) : [] }],
    [d],
  );

  const notFound = q.error instanceof ApiException && q.error.status === 404;

  return (
    <div className="public">
      <header className="public-top">
        <Link to="/" className="brand" aria-label="RepoEasy home">
          <Logo />
          <span>RepoEasy</span>
        </Link>
        <div className="public-top-right">
          {me && (
            <Link className="btn btn-sm" to="/">
              Open my dashboard
            </Link>
          )}
          <ThemeToggle />
        </div>
      </header>
      <main className="public-main" id="main">
        {notFound && (
          <div className="state">
            <div>
              <strong>This page isn't shared</strong>
              <p>
                {owner}/{repo} either doesn't exist or its owner hasn't turned on public sharing.
              </p>
              <Link className="btn btn-primary" to="/">
                What is RepoEasy?
              </Link>
            </div>
          </div>
        )}
        {q.error && !notFound && <ErrorBox error={q.error} onRetry={q.reload} stale={!!d} />}
        {!d && !q.error && (
          <>
            <Skeleton height={100} />
            <Skeleton height={280} />
          </>
        )}
        {d && (
          <>
            <div className="public-head">
              <h1>
                <a href={d.htmlUrl} target="_blank" rel="noreferrer">
                  {d.fullName}
                  <Icon name="external" size={16} className="ext" />
                </a>
              </h1>
              {d.description && <p className="repo-desc">{d.description}</p>}
              {d.language && (
                <p className="repo-meta">
                  <span>
                    <LangDot color={d.languageColor} /> {d.language}
                  </span>
                </p>
              )}
            </div>
            <section className="kpis kpis-6" aria-label="Totals">
              <Tile label="Views" value={d.lifetime.views} sub={d.trafficSince ? `since ${fmtDay(d.trafficSince)}` : 'lifetime'} />
              <Tile label="Unique visitors" value={d.lifetime.uniques} sub="sum of daily uniques" hint={UNIQUES_HINT} />
              <Tile label="Clones" value={d.lifetime.clones} sub="lifetime" />
              <Tile label="Stars" value={d.stars} />
              <Tile label="Forks" value={d.forks} />
              <Tile label="Release downloads" value={d.releaseDownloads} />
            </section>
            <div className="grid-2">
              <Card title="Views and unique visitors" sub="Per day (UTC)">
                <Chart series={views} ariaLabel={`Views and unique visitors for ${d.fullName}`} table empty="No traffic archived yet." />
              </Card>
              <Card title="Clones and unique cloners" sub="Per day (UTC)">
                <Chart series={clones} ariaLabel={`Clones and unique cloners for ${d.fullName}`} table empty="No clones archived yet." />
              </Card>
              <Card title="Stars">
                <Chart series={stars} zeroBase={false} ariaLabel={`Stars for ${d.fullName} over time`} table empty="No star history yet." />
              </Card>
              <Card title="Top referrers">
                <BarList
                  color="var(--s2)"
                  rows={d.referrers.map((r) => ({ key: r.referrer, label: r.referrer, value: r.count, secondary: `${r.uniques.toLocaleString()} unique`, title: `${r.count.toLocaleString()} views, ${r.uniques.toLocaleString()} unique (daily uniques added up)` }))}
                  empty="No referrers recorded."
                  valueLabel="views"
                />
              </Card>
            </div>
          </>
        )}
      </main>
      <footer className="public-foot">
        <Link to="/">
          <Logo size={18} /> Tracked with RepoEasy
        </Link>
        <span className="muted">Lifetime GitHub traffic, archived daily.</span>
      </footer>
    </div>
  );
}
