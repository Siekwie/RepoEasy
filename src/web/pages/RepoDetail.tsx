import { useMemo, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { BadgeMetric, Range, RepoDetail as RepoDetailT, RepoPatch } from '../../shared/api.ts';
import { useApp } from '../context.tsx';
import { api, exportCsvUrl } from '../lib/api.ts';
import { bytes, exact, fmtDay, fmtDateTime, parseRange, rangeLong, relative } from '../lib/format.ts';
import { useFetch, useTitle } from '../lib/hooks.ts';
import { metricPoints, trafficSeries } from '../lib/series.ts';
import { Chart, LangBar } from '../components/charts.tsx';
import { CommitList } from '../components/feeds.tsx';
import { Icon } from '../components/Icon.tsx';
import { RangeSelect } from '../components/RangeSelect.tsx';
import { CiBadge, HEALTH_CHECKS, HealthPill, RepoMarkers } from '../components/repo.tsx';
import { Card, CopyButton, Empty, ErrorBox, LangDot, Num, PctDelta, Seg, SignedDelta, Skeleton, Switch, Tile } from '../components/ui.tsx';

export function RepoDetailPage() {
  const { id } = useParams();
  const n = Number(id);
  if (!Number.isInteger(n)) return <Empty title="That repository doesn't exist">Check the address and try again.</Empty>;
  return <RepoDetail key={n} id={n} />;
}

const BADGES: Array<{ metric: BadgeMetric; label: string }> = [
  { metric: 'views', label: 'Views' },
  { metric: 'visitors', label: 'Visitors' },
  { metric: 'clones', label: 'Clones' },
  { metric: 'stars', label: 'Stars' },
  { metric: 'downloads', label: 'Downloads' },
];

function RepoDetail({ id }: { id: number }) {
  const { me, syncVersion, fail, reloadMe, toast } = useApp();
  const [sp, setSp] = useSearchParams();
  const range = parseRange(sp.get('range'));
  const setRange = (r: Range) =>
    setSp(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.set('range', r);
        return n;
      },
      { replace: true },
    );
  const [cumulativeMode, setCumulativeMode] = useState(false);
  const [starScale, setStarScale] = useState<'linear' | 'log'>('linear');
  const [popRange, setPopRange] = useState<'14d' | 'all'>('14d');
  const [busy, setBusy] = useState(false);
  const [allReleases, setAllReleases] = useState(false);

  const detail = useFetch(() => api.repo(id), [id, syncVersion]);
  const d = detail.data;
  useTitle(d?.fullName ?? 'Repository');
  const loaded = !!d;
  const canTraffic = !!d?.canPush;

  const traffic = useFetch(() => (loaded && canTraffic ? api.repoTraffic(id, range) : Promise.resolve(null)), [id, range, loaded, canTraffic, syncVersion]);
  const metrics = useFetch(() => (loaded ? api.repoMetrics(id, range) : Promise.resolve(null)), [id, range, loaded, syncVersion]);
  const popular = useFetch(
    () => (loaded && canTraffic ? Promise.all([api.repoReferrers(id, popRange), api.repoPaths(id, popRange)]) : Promise.resolve(null)),
    [id, popRange, loaded, canTraffic, syncVersion],
  );
  const commits = useFetch(() => (loaded ? api.repoCommits(id, 10) : Promise.resolve(null)), [id, loaded, syncVersion]);

  const trafficCharts = useMemo(
    () => ({
      views: traffic.data ? trafficSeries(traffic.data.points, 'views', cumulativeMode) : [],
      clones: traffic.data ? trafficSeries(traffic.data.points, 'clones', cumulativeMode) : [],
    }),
    [traffic.data, cumulativeMode],
  );
  const pts = metrics.data?.points;
  const starsSeries = useMemo(
    () => [{ key: 'stars', label: 'Stars', color: 'var(--s7)', type: 'line' as const, data: pts ? metricPoints(pts, 'stars', true) : [] }],
    [pts],
  );
  const forksSeries = useMemo(() => [{ key: 'forks', label: 'Forks', color: 'var(--s6)', type: 'line' as const, data: pts ? metricPoints(pts, 'forks') : [] }], [pts]);
  const issuesSeries = useMemo(
    () => [
      { key: 'issues', label: 'Open issues', color: 'var(--s2)', type: 'line' as const, data: pts ? metricPoints(pts, 'openIssues') : [] },
      { key: 'prs', label: 'Open pull requests', color: 'var(--s7)', type: 'line' as const, data: pts ? metricPoints(pts, 'openPrs') : [] },
    ],
    [pts],
  );
  const downloadsSeries = useMemo(
    () => [{ key: 'dl', label: 'Release downloads (total)', color: 'var(--s3)', type: 'area' as const, data: pts ? metricPoints(pts, 'releaseDownloads') : [] }],
    [pts],
  );

  async function patch(p: RepoPatch): Promise<boolean> {
    setBusy(true);
    try {
      const u = await api.patchRepo(id, p);
      detail.setData((prev) => (prev ? ({ ...prev, ...u } as RepoDetailT) : prev));
      if (p.tracked !== undefined) void reloadMe();
      return true;
    } catch (e) {
      fail(e);
      return false;
    } finally {
      setBusy(false);
    }
  }

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
  const sharePages = me?.limits.sharePages ?? false;
  const t = traffic.data;

  return (
    <>
      <p className="crumb">
        <Link to={followed ? '/following' : '/repos'}>← {followed ? 'Following' : 'Repositories'}</Link>
      </p>
      <header className="repo-head">
        <div className="repo-title">
          <h1>
            <a href={d.htmlUrl} target="_blank" rel="noreferrer">
              <span className="muted">{d.owner}/</span>
              {d.name}
              <Icon name="external" size={16} className="ext" />
            </a>
          </h1>
          <div className="repo-markers">
            <RepoMarkers repo={d} />
            {d.relation !== 'owner' && <span className="marker">{d.relation === 'followed' ? 'Followed' : d.relation === 'org' ? 'Organization' : 'Collaborator'}</span>}
          </div>
        </div>
        {d.description && <p className="repo-desc">{d.description}</p>}
        <p className="repo-meta">
          {d.language && (
            <span>
              <LangDot color={d.languageColor} /> {d.language}
            </span>
          )}
          {d.license && <span>{d.license}</span>}
          {d.defaultBranch && <span>Branch {d.defaultBranch}</span>}
          {d.createdAt && <span title={fmtDateTime(d.createdAt)}>Created {fmtDay(d.createdAt.slice(0, 10))}</span>}
          {d.pushedAt && <span title={fmtDateTime(d.pushedAt)}>Pushed {relative(d.pushedAt)}</span>}
          {d.sizeKb > 0 && <span>{bytes(d.sizeKb * 1024)}</span>}
          <CiBadge state={d.ciState} />
        </p>
        {d.topics.length > 0 && (
          <ul className="topics" aria-label="Topics">
            {d.topics.map((tp) => (
              <li key={tp}>{tp}</li>
            ))}
          </ul>
        )}
        <div className="repo-actions">
          {!followed && (
            <>
              <Switch
                checked={d.tracked}
                busy={busy}
                disabled={!d.canPush && !d.tracked}
                onChange={(v) => void patch({ tracked: v })}
                label={d.tracked ? 'Tracking traffic' : 'Track traffic'}
              />
              <button className="btn btn-sm" aria-pressed={d.pinned} disabled={busy} onClick={() => void patch({ pinned: !d.pinned })}>
                <Icon name="pin" size={14} /> {d.pinned ? 'Pinned' : 'Pin'}
              </button>
              <button className="btn btn-sm" disabled={busy} onClick={() => void patch({ hidden: !d.hidden })}>
                <Icon name={d.hidden ? 'eye' : 'eyeoff'} size={14} /> {d.hidden ? 'Unhide' : 'Hide'}
              </button>
            </>
          )}
          {followed && <UnfollowButton id={id} name={d.fullName} />}
        </div>
        {!followed && <TagsAndNote repo={d} busy={busy} onPatch={patch} />}
      </header>

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
          <strong className="num">{exact(d.trafficLifetime.uniques)}</strong> unique visitors, <strong className="num">{exact(d.trafficLifetime.clones)}</strong> clones.
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
        {canTraffic ? (
          <>
            <Card title="Views and unique visitors" sub={cumulativeMode ? 'Running total over the period' : 'Per day (UTC)'} busy={traffic.loading}>
              {traffic.error && !t ? (
                <ErrorBox error={traffic.error} onRetry={traffic.reload} />
              ) : t ? (
                <Chart series={trafficCharts.views} ariaLabel={`Views and unique visitors for ${d.fullName}, ${rangeLong(range)}`} table empty="No traffic archived for this period yet." />
              ) : (
                <Skeleton height={240} />
              )}
            </Card>
            <Card title="Clones and unique cloners" sub={cumulativeMode ? 'Running total over the period' : 'Per day (UTC)'} busy={traffic.loading}>
              {traffic.error && !t ? (
                <ErrorBox error={traffic.error} onRetry={traffic.reload} />
              ) : t ? (
                <Chart series={trafficCharts.clones} ariaLabel={`Clones and unique cloners for ${d.fullName}, ${rangeLong(range)}`} table empty="No clones archived for this period yet." />
              ) : (
                <Skeleton height={240} />
              )}
            </Card>
          </>
        ) : (
          <Card title="Traffic" className="span-2">
            <p className="note">
              {followed
                ? 'Views and clones are only visible to people with push access to a repository, so they are not available for followed repositories. Stars, forks, issues and releases are tracked below.'
                : "GitHub only reports views and clones to people with push access, and your account doesn't have it for this repository. Stars, forks, issues and releases are still tracked below."}
            </p>
          </Card>
        )}

        <Card
          title="Stars"
          sub={d.starHistoryComplete ? 'Full history' : 'Older history is still being backfilled'}
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
          {metrics.error && !metrics.data ? (
            <ErrorBox error={metrics.error} onRetry={metrics.reload} />
          ) : metrics.data ? (
            <Chart series={starsSeries} scale={starScale} zeroBase={false} ariaLabel={`Stars for ${d.fullName} over time`} table empty="No star history yet." />
          ) : (
            <Skeleton height={240} />
          )}
        </Card>
        <Card title="Forks" busy={metrics.loading}>
          {metrics.data ? <Chart series={forksSeries} zeroBase={false} ariaLabel={`Forks for ${d.fullName} over time`} table empty="No fork history yet." /> : <Skeleton height={240} />}
        </Card>
        <Card title="Open issues and pull requests" busy={metrics.loading}>
          {metrics.data ? <Chart series={issuesSeries} ariaLabel={`Open issues and pull requests for ${d.fullName} over time`} table empty="No issue history yet." /> : <Skeleton height={240} />}
        </Card>
        <Card title="Release downloads" sub="Cumulative, all releases" busy={metrics.loading}>
          {metrics.data ? <Chart series={downloadsSeries} ariaLabel={`Cumulative release downloads for ${d.fullName}`} table empty="No release downloads recorded." /> : <Skeleton height={240} />}
        </Card>
      </div>

      {canTraffic && (
        <Card
          title="Referrers and popular content"
          sub={
            popular.data?.[0].range === 'all'
              ? `Estimated from archived snapshots${popular.data[0].since ? ` since ${fmtDay(popular.data[0].since)}` : ''}`
              : "GitHub's rolling 14-day window"
          }
          actions={
            <Seg<'14d' | 'all'>
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
          {popular.error && !popular.data ? (
            <ErrorBox error={popular.error} onRetry={popular.reload} />
          ) : popular.data ? (
            <div className="grid-2 grid-flush">
              <div>
                <h3>Referrers</h3>
                {popular.data[0].rows.length === 0 ? (
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
                          <th scope="col" className="r">
                            Unique
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {popular.data[0].rows.map((r) => (
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
                {popular.data[1].rows.length === 0 ? (
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
                          <th scope="col" className="r">
                            Unique
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {popular.data[1].rows.map((r) => (
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
          ) : (
            <Skeleton height={160} />
          )}
        </Card>
      )}

      <div className="grid-2 grid-top">
        <Card title="Releases" sub={`${d.releases.length} release${d.releases.length === 1 ? '' : 's'}, ${exact(d.releaseDownloads)} downloads`}>
          {d.releases.length === 0 ? (
            <p className="muted pad">No releases published.</p>
          ) : (
            <>
              <ul className="releases">
                {(allReleases ? d.releases : d.releases.slice(0, 6)).map((r) => (
                  <li key={r.id}>
                    <details>
                      <summary>
                        <span className="rel-tag">
                          <a href={r.htmlUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                            {r.name || r.tag}
                          </a>
                          {r.prerelease && <span className="marker">Pre-release</span>}
                          {r.name && r.name !== r.tag && <span className="muted"> {r.tag}</span>}
                        </span>
                        <span className="rel-date muted">{r.publishedAt ? fmtDay(r.publishedAt.slice(0, 10)) : 'Draft'}</span>
                        <span className="rel-dl" title={`${exact(r.downloads)} downloads`}>
                          <Icon name="download" size={13} /> <Num v={r.downloads} />
                        </span>
                      </summary>
                      {r.assets.length === 0 ? (
                        <p className="muted pad">No downloadable assets.</p>
                      ) : (
                        <ul className="assets">
                          {r.assets.map((a) => (
                            <li key={a.name}>
                              <span className="clip">{a.name}</span>
                              <span className="muted">{bytes(a.size)}</span>
                              <span className="num">{exact(a.downloads)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </details>
                  </li>
                ))}
              </ul>
              {d.releases.length > 6 && (
                <button className="btn btn-sm btn-quiet" onClick={() => setAllReleases((v) => !v)}>
                  {allReleases ? 'Show fewer' : `Show all ${d.releases.length}`}
                </button>
              )}
            </>
          )}
        </Card>
        <div className="stack">
          <Card title="Recent commits">
            {commits.error && !commits.data ? (
              <p className="muted pad">Commits aren't available for this repository yet.</p>
            ) : commits.data ? (
              <CommitList commits={commits.data} showRepo={false} />
            ) : (
              <Skeleton height={140} />
            )}
          </Card>
          <Card title="Languages">
            <LangBar languages={d.languages} />
          </Card>
        </div>
      </div>

      <div className="grid-2 grid-top">
        <Card title="Health" sub="Quick checks that make a repository easier to find and trust">
          <div className="health-summary">
            <HealthPill health={d.health} />
            <span className="muted">{d.health.issues.length === 0 ? 'Everything checks out.' : `${d.health.issues.length} to fix`}</span>
          </div>
          <ul className="checklist">
            {HEALTH_CHECKS.map((c) => {
              const bad = d.health.issues.includes(c.issue);
              return (
                <li key={c.issue} className={bad ? 'is-bad' : 'is-ok'}>
                  <Icon name={bad ? 'warn' : 'check'} size={16} />
                  <div>
                    <strong>{bad ? c.bad : c.ok}</strong>
                    {bad && <p>{c.fix}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>

        {d.canPush && <GithubEditor repo={d} onSaved={(u) => detail.setData((prev) => (prev ? ({ ...prev, ...u } as RepoDetailT) : prev))} />}
      </div>

      {!followed && (
        <Card
          title="Sharing"
          sub="A public page with lifetime totals and charts, plus README badges. Visitors need no account."
          actions={
            <Switch
              checked={d.shareEnabled}
              busy={busy}
              disabled={!d.canAdmin || ((!sharePages || d.private) && !d.shareEnabled)}
              onChange={(v) => void patch({ shareEnabled: v })}
              label={d.shareEnabled ? 'Public page on' : 'Public page off'}
            />
          }
        >
          {d.private ? (
            <p className="note">Private repositories cannot be shared publicly.</p>
          ) : !d.canAdmin ? (
            <p className="note">Only admins of this repository can change sharing.</p>
          ) : null}
          {!sharePages && !d.shareEnabled && !d.private && d.canAdmin && (
            <p className="note">
              Public share pages are part of Pro. <Link to="/settings#plan">See plans</Link>
            </p>
          )}
          {d.shareEnabled ? (
            <div className="share">
              <div className="share-row">
                <span className="share-label">Public page</span>
                <div className="share-main">
                  <div className="share-copy">
                    <code className="code-line">{d.share.pageUrl}</code>
                    <a className="btn btn-sm" href={d.share.pageUrl} target="_blank" rel="noreferrer">
                      <Icon name="external" size={14} /> Open
                    </a>
                    <CopyButton text={d.share.pageUrl} label="Copy link" />
                  </div>
                </div>
              </div>
              {BADGES.map((b) => {
                const url = d.share.badges[b.metric];
                const md = `[![${b.label}](${url})](${d.share.pageUrl})`;
                return (
                  <div className="share-row" key={b.metric}>
                    <span className="share-label">{b.label} badge</span>
                    <div className="share-main">
                      <img src={url} alt={`${b.label} badge preview`} height={20} className="badge-img" />
                      <div className="share-copy">
                        <code className="code-line">{md}</code>
                        <CopyButton text={md} label="Copy Markdown" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            sharePages && <p className="muted">Turn on the public page to get a link and README badges. Anyone with the link will see lifetime traffic totals, charts and top referrers.</p>
          )}
        </Card>
      )}

      <Card title="Export" sub="Download this repository's data as CSV">
        <div className="btn-row">
          {canTraffic && (
            <a className="btn btn-sm" href={exportCsvUrl(id, 'traffic')} download>
              <Icon name="download" size={14} /> Daily traffic
            </a>
          )}
          <a className="btn btn-sm" href={exportCsvUrl(id, 'metrics')} download>
            <Icon name="download" size={14} /> Stars, forks and issues
          </a>
          {canTraffic && (
            <>
              <a className="btn btn-sm" href={exportCsvUrl(id, 'referrers')} download>
                <Icon name="download" size={14} /> Referrers
              </a>
              <a className="btn btn-sm" href={exportCsvUrl(id, 'paths')} download>
                <Icon name="download" size={14} /> Popular pages
              </a>
            </>
          )}
        </div>
      </Card>
    </>
  );
}

function UnfollowButton({ id, name }: { id: number; name: string }) {
  const { fail, reloadMe } = useApp();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn btn-sm"
      disabled={busy}
      onClick={async () => {
        if (!window.confirm(`Stop following ${name}?`)) return;
        setBusy(true);
        try {
          await api.unfollow(id);
          void reloadMe();
          nav('/following');
        } catch (e) {
          fail(e);
          setBusy(false);
        }
      }}
    >
      Unfollow
    </button>
  );
}

function TagsAndNote({ repo, busy, onPatch }: { repo: RepoDetailT; busy: boolean; onPatch: (p: RepoPatch) => Promise<boolean> }) {
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState(repo.note ?? '');
  const noteDirty = note.trim() !== (repo.note ?? '');

  function add() {
    const v = draft.trim().replace(/,+$/, '').trim();
    if (!v) return;
    setDraft('');
    if (repo.tags.some((t) => t.toLowerCase() === v.toLowerCase())) return;
    void onPatch({ tags: [...repo.tags, v] });
  }
  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add();
    } else if (e.key === 'Backspace' && !draft && repo.tags.length) {
      void onPatch({ tags: repo.tags.slice(0, -1) });
    }
  }
  return (
    <div className="tags-note">
      <div className="field">
        <span className="field-label" id="tags-label">
          Your tags
        </span>
        <div className="tag-input" aria-labelledby="tags-label">
          {repo.tags.map((t) => (
            <span className="tag tag-removable" key={t}>
              {t}
              <button type="button" disabled={busy} onClick={() => void onPatch({ tags: repo.tags.filter((x) => x !== t) })} aria-label={`Remove tag ${t}`}>
                <Icon name="x" size={11} />
              </button>
            </span>
          ))}
          <input
            type="text"
            value={draft}
            maxLength={40}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            onBlur={add}
            placeholder={repo.tags.length ? 'Add tag' : 'Add tags to group repositories'}
            aria-label="Add a tag"
          />
        </div>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="repo-note">
          Private note
        </label>
        <div className="note-edit">
          <textarea id="repo-note" rows={2} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} placeholder="Only you can see this" />
          <button className="btn btn-sm" disabled={!noteDirty || busy} onClick={() => void onPatch({ note: note.trim() || null })}>
            Save note
          </button>
        </div>
      </div>
    </div>
  );
}

function GithubEditor({ repo, onSaved }: { repo: RepoDetailT; onSaved: (u: Partial<RepoDetailT>) => void }) {
  const { fail, toast } = useApp();
  const [description, setDescription] = useState(repo.description ?? '');
  const [homepage, setHomepage] = useState(repo.homepage ?? '');
  const [topics, setTopics] = useState(repo.topics.join(', '));
  const [saving, setSaving] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const list = Array.from(new Set(topics.split(/[\s,]+/).map((t) => t.trim().toLowerCase()).filter(Boolean)));
      const u = await api.patchRepoGithub(repo.id, { description: description.trim(), homepage: homepage.trim(), topics: list });
      onSaved(u);
      setTopics(list.join(', '));
      toast('Saved to GitHub', 'success');
    } catch (err) {
      fail(err);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Card title="Edit on GitHub" sub="Saving writes straight to the repository on GitHub. Needs admin access.">
      <form className="form" onSubmit={(e) => void save(e)}>
        <label className="field">
          <span className="field-label">Description</span>
          <input type="text" value={description} maxLength={350} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Homepage</span>
          <input type="url" value={homepage} placeholder="https://" onChange={(e) => setHomepage(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Topics</span>
          <input type="text" value={topics} placeholder="react, analytics, github" onChange={(e) => setTopics(e.target.value)} />
          <span className="field-hint">Separate with commas or spaces. Lowercase letters, numbers and hyphens.</span>
        </label>
        <div>
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save to GitHub'}
          </button>
        </div>
      </form>
    </Card>
  );
}
