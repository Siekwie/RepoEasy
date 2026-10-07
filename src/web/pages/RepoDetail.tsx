import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { RepoDetail as RepoDetailT, RepoSummary } from '../../shared/api.ts';
import { useApp } from '../context.tsx';
import { api } from '../lib/api.ts';
import { UNIQUES_HINT, exact, fmtDay, rangeLong } from '../lib/format.ts';
import { useFetch, useRangeParam, useTitle } from '../lib/hooks.ts';
import { usePatchRepo } from '../lib/repo-actions.ts';
import { CommitList } from '../components/feeds.tsx';
import { LangBar } from '../components/charts.tsx';
import { RangeSelect } from '../components/RangeSelect.tsx';
import { Card, Empty, ErrorBox, Fetched, PctDelta, Seg, SignedDelta, Skeleton, Tile } from '../components/ui.tsx';
import { ExportCard } from './repo/ExportCard.tsx';
import { GithubEditor } from './repo/GithubEditor.tsx';
import { HealthCard } from './repo/HealthCard.tsx';
import { MetricCards } from './repo/MetricCards.tsx';
import { PopularCard } from './repo/PopularCard.tsx';
import { ReleasesCard } from './repo/ReleasesCard.tsx';
import { RepoHeader } from './repo/RepoHeader.tsx';
import { SharingCard } from './repo/SharingCard.tsx';
import { TrafficCards } from './repo/TrafficCards.tsx';

export function RepoDetailPage() {
  const { id } = useParams();
  const n = Number(id);
  if (!Number.isInteger(n)) return <Empty title="That repository doesn't exist">Check the address and try again.</Empty>;
  return <RepoDetail key={n} id={n} />;
}

function RepoDetail({ id }: { id: number }) {
  const { syncVersion } = useApp();
  const [range, setRange] = useRangeParam();
  const [cumulativeMode, setCumulativeMode] = useState(false);

  const detail = useFetch(() => api.repo(id), [id], syncVersion);
  const d = detail.data;
  useTitle(d?.fullName ?? 'Repository');
  const loaded = !!d;
  const canTraffic = !!d?.canPush;

  const traffic = useFetch(() => (loaded && canTraffic ? api.repoTraffic(id, range) : Promise.resolve(null)), [id, range, loaded, canTraffic], syncVersion);
  const commits = useFetch(() => (loaded ? api.repoCommits(id, 10) : Promise.resolve(null)), [id, loaded], syncVersion);

  // the server returns the summary fields; merge them into the open detail instead of refetching
  const merge = useCallback(
    (u: Partial<RepoSummary>) => detail.setData((prev) => (prev ? ({ ...prev, ...u } as RepoDetailT) : prev)),
    [detail.setData],
  );
  const { patch, busy } = usePatchRepo(merge);

  if (detail.error && !d) {
    const notFound = (detail.error as { status?: number }).status === 404;
    return notFound ? (
      <Empty
        title="Repository not found"
        action={
          <Link className="btn" to="/repos">
            Back to repositories
          </Link>
        }
      >
        It may have been unfollowed, deleted, or never synced.
      </Empty>
    ) : (
      <ErrorBox error={detail.error} onRetry={detail.reload} />
    );
  }
  if (!d) {
    return (
      <>
        <Skeleton height={140} />
        <Skeleton height={300} />
      </>
    );
  }

  const followed = d.relation === 'followed';
  const t = traffic.data;

  return (
    <>
      {detail.error && <ErrorBox error={detail.error} onRetry={detail.reload} stale />}
      <RepoHeader repo={d} busy={busy.size > 0} onPatch={(p) => patch(id, p)} />

      <section className="kpis kpis-6" aria-label="Current numbers">
        <Tile label="Stars" value={d.stars} sub={<SignedDelta value={d.starsDelta30d} suffix="30d" />} />
        <Tile label="Forks" value={d.forks} sub={<SignedDelta value={d.forksDelta30d} suffix="30d" />} />
        <Tile label="Open issues" value={d.openIssues} sub={`${d.openPrs.toLocaleString()} pull request${d.openPrs === 1 ? '' : 's'}`} />
        <Tile label="Release downloads" value={d.releaseDownloads} sub={d.latestRelease ? `Latest ${d.latestRelease.tag}` : 'No releases'} />
        {t ? (
          <>
            <Tile label="Views" value={t.totals.views} sub={<PctDelta cur={t.totals.views} prev={t.previous?.views} label={rangeLong(range)} />} />
            <Tile label="Clones" value={t.totals.clones} sub={<PctDelta cur={t.totals.clones} prev={t.previous?.clones} label={rangeLong(range)} />} />
          </>
        ) : null}
      </section>
      {d.canPush && d.trafficLifetime && (
        <p className="muted lifetime-line">
          Lifetime since {fmtDay(d.trafficSince)}: <strong className="num">{exact(d.trafficLifetime.views)}</strong> views from{' '}
          <strong className="num has-hint" title={UNIQUES_HINT}>
            {exact(d.trafficLifetime.uniques)}
          </strong>{' '}
          unique visitors (summed daily), <strong className="num">{exact(d.trafficLifetime.clones)}</strong> clones.
        </p>
      )}

      <div className="toolbar toolbar-sticky">
        <RangeSelect value={range} onChange={setRange} />
        {canTraffic && (
          <Seg<'daily' | 'cumulative'>
            label="Traffic display"
            value={cumulativeMode ? 'cumulative' : 'daily'}
            onChange={(v) => setCumulativeMode(v === 'cumulative')}
            options={[
              { value: 'daily', label: 'Daily' },
              { value: 'cumulative', label: 'Cumulative' },
            ]}
          />
        )}
      </div>

      <div className="grid-2">
        <TrafficCards repo={d} traffic={traffic} range={range} cumulative={cumulativeMode} />
        <MetricCards repo={d} range={range} />
      </div>

      {canTraffic && <PopularCard id={id} />}

      <div className="grid-2 grid-top">
        <div className="stack">
          <ReleasesCard repo={d} />
          <Card title="Languages">
            <LangBar languages={d.languages} />
          </Card>
        </div>
        <Card title="Recent commits">
          {commits.error && !commits.data ? (
            <p className="muted pad">Commits aren't available for this repository yet.</p>
          ) : (
            <Fetched f={commits} height={140}>
              {(list) => <CommitList commits={list} showRepo={false} />}
            </Fetched>
          )}
        </Card>
      </div>

      <div className="grid-2 grid-top">
        <HealthCard health={d.health} host={d.host} />
        {d.canPush && <GithubEditor repo={d} onSaved={merge} />}
      </div>

      {!followed && <SharingCard repo={d} busy={busy.size > 0} onPatch={(p) => patch(id, p)} />}

      <ExportCard id={id} canTraffic={canTraffic} />
    </>
  );
}
