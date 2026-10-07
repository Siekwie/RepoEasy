import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { RepoSummary } from '../../shared/api.ts';
import { useApp } from '../context.tsx';
import { api } from '../lib/api.ts';
import { relative, fmtDateTime } from '../lib/format.ts';
import { useFetch, useInterval, useTitle } from '../lib/hooks.ts';
import { usePatchRepo } from '../lib/repo-actions.ts';
import { Sparkline } from '../components/charts.tsx';
import { Icon } from '../components/Icon.tsx';
import { CiBadge, HealthPill, RepoMarkers } from '../components/repo.tsx';
import { Empty, ErrorBox, FirstSync, INSTALL_HINT, InstallRepos, LangDot, Num, PageHead, Skeleton, Switch, SignedDelta, UsageMeter } from '../components/ui.tsx';

type SortKey = 'name' | 'stars' | 'views14' | 'viewsLife' | 'clonesLife' | 'issues' | 'ci' | 'pushed' | 'health';
type Filter = 'all' | 'tracked' | 'untracked' | 'private' | 'public' | 'archived' | 'pinned';

const CI_RANK: Record<string, number> = { FAILURE: 0, ERROR: 1, PENDING: 2, EXPECTED: 3, SUCCESS: 4 };

function sortValue(r: RepoSummary, k: SortKey): number | string | null {
  switch (k) {
    case 'name':
      return r.fullName.toLowerCase();
    case 'stars':
      return r.stars;
    case 'views14':
      return r.traffic14d?.views ?? null;
    case 'viewsLife':
      return r.trafficLifetime?.views ?? null;
    case 'clonesLife':
      return r.trafficLifetime?.clones ?? null;
    case 'issues':
      return r.openIssues;
    case 'ci':
      return r.ciState ? (CI_RANK[r.ciState] ?? 5) : null;
    case 'pushed':
      return r.pushedAt ? new Date(r.pushedAt).getTime() : null;
    case 'health':
      return r.health.score;
  }
}

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'tracked', label: 'Tracked' },
  { value: 'untracked', label: 'Not tracked' },
  { value: 'private', label: 'Private' },
  { value: 'public', label: 'Public' },
  { value: 'archived', label: 'Archived' },
  { value: 'pinned', label: 'Pinned' },
];

export function Repos() {
  useTitle('Repositories');
  const { info, sync, syncVersion, toast } = useApp();
  const repos = useFetch(() => api.repos(), [], syncVersion);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [tag, setTag] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'stars', dir: 'desc' });
  const [bulk, setBulk] = useState(false);

  const own = useMemo(() => (repos.data ?? []).filter((r) => r.relation !== 'followed'), [repos.data]);
  useInterval(() => repos.reload(), 6000, !!sync?.running && repos.data != null && own.length === 0);

  const allTags = useMemo(() => Array.from(new Set(own.flatMap((r) => r.tags))).sort(), [own]);
  const hiddenCount = own.filter((r) => r.hidden).length;

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = own.filter((r) => {
      if (r.hidden && !showHidden) return false;
      if (filter === 'tracked' && !r.tracked) return false;
      if (filter === 'untracked' && r.tracked) return false;
      if (filter === 'private' && !r.private) return false;
      if (filter === 'public' && r.private) return false;
      if (filter === 'archived' && !r.archived) return false;
      if (filter === 'pinned' && !r.pinned) return false;
      if (tag && !r.tags.includes(tag)) return false;
      if (needle) {
        const hay = `${r.fullName} ${r.description ?? ''} ${r.language ?? ''} ${r.tags.join(' ')}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    const dir = sort.dir === 'asc' ? 1 : -1;
    return list.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const va = sortValue(a, sort.key);
      const vb = sortValue(b, sort.key);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (va < vb) return -dir;
      if (va > vb) return dir;
      return a.fullName.localeCompare(b.fullName);
    });
  }, [own, q, filter, tag, showHidden, sort]);

  function setSortKey(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' ? 'asc' : 'desc' }));
  }

  const replace = useCallback((u: RepoSummary) => repos.setData((prev) => prev?.map((x) => (x.id === u.id ? u : x)) ?? prev), [repos.setData]);
  const { patch, busy } = usePatchRepo(replace);

  async function bulkTrack(on: boolean) {
    const targets = rows.filter((r) => r.tracked !== on && (!on || r.canPush));
    if (targets.length === 0) {
      toast(on ? 'Every repository shown is already tracked (or has no push access).' : 'No tracked repositories in this view.');
      return;
    }
    const verb = on ? 'Start tracking' : 'Stop tracking';
    if (!window.confirm(`${verb} ${targets.length} ${targets.length === 1 ? 'repository' : 'repositories'}?`)) return;
    setBulk(true);
    let done = 0;
    for (const r of targets) {
      const ok = await patch(r.id, { tracked: on });
      if (!ok) break;
      done++;
    }
    setBulk(false);
    if (done > 0) toast(`${on ? 'Now tracking' : 'Stopped tracking'} ${done} ${done === 1 ? 'repository' : 'repositories'}.`, 'success');
  }

  const loadedEmpty = repos.data != null && own.length === 0;

  function Th({ k, label, right, className, title }: { k: SortKey; label: string; right?: boolean; className?: string; title?: string }) {
    const active = sort.key === k;
    return (
      <th scope="col" className={`${right ? 'r' : ''} ${className ?? ''}`} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button type="button" className={`th-btn ${active ? 'is-active' : ''}`} title={title} onClick={() => setSortKey(k)}>
          {label}
          <Icon name="chev" size={12} className={active ? (sort.dir === 'asc' ? 'flip' : '') : 'faint'} />
        </button>
      </th>
    );
  }

  return (
    <>
      <PageHead
        title="Repositories"
        sub={
          <>
            Tracked repositories have their traffic archived every sync. Untracked ones still show stars and activity.
            {info.auth.githubAppInstallUrl && (
              <span className="page-sub-extra">
                <InstallRepos />
              </span>
            )}
          </>
        }
        actions={<UsageMeter kind="tracked" variant="inline" />}
      />
      {repos.error && <ErrorBox error={repos.error} onRetry={repos.reload} stale={!!repos.data} />}
      {!repos.data && !repos.error && <Skeleton height={320} />}
      {loadedEmpty && (sync?.running ? <FirstSync step={sync.step} /> : <Empty
            title="No repositories yet"
            action={
              info.auth.githubAppInstallUrl ? (
                <InstallRepos button hint={false} />
              ) : undefined
            }
          >
            Run a sync (top right) to pull in your repositories.{info.auth.githubAppInstallUrl ? ` ${INSTALL_HINT}` : ''}
          </Empty>)}
      {own.length > 0 && (
        <>
          <div className="toolbar">
            <label className="search">
              <Icon name="search" size={15} />
              <span className="sr-only">Search repositories</span>
              <input type="search" placeholder="Search name, language, tag" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            <div className="chips" role="group" aria-label="Filter">
              {FILTERS.map((f) => (
                <button key={f.value} type="button" className="chip" aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>
                  {f.label}
                </button>
              ))}
            </div>
            {allTags.length > 0 && (
              <label className="select-wrap">
                <span className="sr-only">Filter by tag</span>
                <select value={tag} onChange={(e) => setTag(e.target.value)}>
                  <option value="">Any tag</option>
                  {allTags.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="toolbar-end">
              {hiddenCount > 0 && <Switch checked={showHidden} onChange={setShowHidden} label={`Show hidden (${hiddenCount})`} />}
              <button type="button" className="btn btn-sm" disabled={bulk} onClick={() => void bulkTrack(true)} title="Track every repository in the current view that you can push to">
                Track all shown
              </button>
              <button type="button" className="btn btn-sm" disabled={bulk} onClick={() => void bulkTrack(false)}>
                Untrack all shown
              </button>
            </div>
          </div>

          <div className={`table-wrap table-fit ${repos.loading ? 'is-refreshing' : ''}`} tabIndex={0} role="region" aria-label="Repositories table">
            <table className="table repos-table">
              <thead>
                <tr>
                  {Th({ k: 'name', label: 'Repository', className: 'sticky-col' })}
                  {Th({ k: 'stars', label: 'Stars', right: true, title: 'Stars, with the change over the last 30 days underneath' })}
                  {Th({ k: 'views14', label: 'Views 14d', right: true, title: 'Views in the last 14 days' })}
                  {Th({ k: 'viewsLife', label: 'Views all', right: true, title: 'Lifetime views since tracking started' })}
                  {Th({ k: 'clonesLife', label: 'Clones all', right: true, title: 'Lifetime clones since tracking started' })}
                  {Th({ k: 'issues', label: 'Issues / PRs', right: true, title: 'Open issues / open pull requests (sorted by issues)' })}
                  {Th({ k: 'ci', label: 'CI' })}
                  {Th({ k: 'pushed', label: 'Last push' })}
                  <th scope="col" title="Daily views over the last 30 days">
                    Views 30d
                  </th>
                  {Th({ k: 'health', label: 'Health' })}
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const b = busy.has(r.id);
                  return (
                    <tr key={r.id} className={r.hidden ? 'is-dim' : ''}>
                      <th scope="row" className="sticky-col cell-name cell-fluid">
                        <div className="name-line">
                          {r.pinned && <Icon name="pin" size={13} className="pin-mark" />}
                          <Link to={`/repos/${r.id}`}>
                            <span className="muted">{r.owner}/</span>
                            {r.name}
                          </Link>
                          <RepoMarkers repo={r} />
                        </div>
                        <div className="sub-line">
                          {r.language && (
                            <span>
                              <LangDot color={r.languageColor} /> {r.language}
                            </span>
                          )}
                          {r.tags.map((t) => (
                            <button key={t} type="button" className="tag" onClick={() => setTag(t)} title={`Filter by ${t}`}>
                              {t}
                            </button>
                          ))}
                          {r.hidden && <span className="muted">Hidden</span>}
                        </div>
                      </th>
                      <td className="r">
                        <Num v={r.stars} />
                        {r.starsDelta30d !== 0 && (
                          <div className="cell-sub">
                            <SignedDelta value={r.starsDelta30d} />
                          </div>
                        )}
                      </td>
                      <td className="r">{r.traffic14d ? <Num v={r.traffic14d.views} /> : <span className="muted" title="Traffic needs push access">–</span>}</td>
                      <td
                        className="r"
                        title={r.trafficSince ? `Since ${new Date(`${r.trafficSince}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })}` : undefined}
                      >
                        {r.trafficLifetime ? <Num v={r.trafficLifetime.views} /> : <span className="muted">–</span>}
                      </td>
                      <td className="r">{r.trafficLifetime ? <Num v={r.trafficLifetime.clones} /> : <span className="muted">–</span>}</td>
                      <td className="r nowrap" title={`${r.openIssues} open issues, ${r.openPrs} open pull requests`}>
                        <Num v={r.openIssues} />
                        <span className="muted"> / </span>
                        <Num v={r.openPrs} />
                      </td>
                      <td>
                        <CiBadge state={r.ciState} />
                      </td>
                      <td title={fmtDateTime(r.pushedAt)} className="nowrap">
                        {r.pushedAt ? relative(r.pushedAt) : '–'}
                      </td>
                      <td>
                        <Sparkline width={64} height={22} fromZero data={r.viewsSpark} label={r.canPush ? `Daily views over the last 30 days, ${r.viewsSpark.reduce((a, v) => a + v, 0).toLocaleString()} total` : 'No traffic access'} />
                      </td>
                      <td>
                        <HealthPill health={r.health} />
                      </td>
                      <td>
                        <div className="row-actions">
                          <Switch
                            hideLabel
                            checked={r.tracked}
                            busy={b || bulk}
                            disabled={!r.canPush && !r.tracked}
                            onChange={(v) => void patch(r.id, { tracked: v })}
                            label={`Track ${r.fullName}`}
                          />
                          <button type="button"
                            className="btn btn-icon btn-sm"
                            aria-pressed={r.pinned}
                            disabled={b}
                            onClick={() => void patch(r.id, { pinned: !r.pinned })}
                            title={r.pinned ? 'Unpin' : 'Pin to top'}
                            aria-label={`${r.pinned ? 'Unpin' : 'Pin'} ${r.fullName}`}
                          >
                            <Icon name="pin" size={14} />
                          </button>
                          <button type="button"
                            className="btn btn-icon btn-sm"
                            disabled={b}
                            onClick={async () => {
                              const ok = await patch(r.id, { hidden: !r.hidden });
                              if (ok && !r.hidden) toast(`${r.name} is hidden. Use "Show hidden" to see it again.`);
                            }}
                            title={r.hidden ? 'Unhide' : 'Hide from lists'}
                            aria-label={`${r.hidden ? 'Unhide' : 'Hide'} ${r.fullName}`}
                          >
                            <Icon name={r.hidden ? 'eye' : 'eyeoff'} size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length === 0 && <p className="muted pad">No repositories match these filters.</p>}
          </div>
          <p className="muted foot-note">
            Showing {rows.length} of {own.length}. Switch on "track" to archive traffic; repositories you can't push to have no traffic data.
          </p>
        </>
      )}
    </>
  );
}
