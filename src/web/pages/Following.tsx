import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { parseRepoName } from '../../shared/repo-input.ts';
import { useApp } from '../context.tsx';
import { api } from '../lib/api.ts';
import { fmtDay, relative } from '../lib/format.ts';
import { useFetch, useTitle } from '../lib/hooks.ts';
import { Sparkline } from '../components/charts.tsx';
import { Icon } from '../components/Icon.tsx';
import { RepoMarkers } from '../components/repo.tsx';
import { Empty, ErrorBox, LangDot, Num, PageHead, SignedDelta, Skeleton, UsageMeter } from '../components/ui.tsx';

export function Following() {
  useTitle('Following');
  const { syncVersion, fail, reloadMe, toast } = useApp();
  const repos = useFetch(() => api.repos(), [], syncVersion);
  const [input, setInput] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);

  const followed = useMemo(
    () => (repos.data ?? []).filter((r) => r.relation === 'followed').sort((a, b) => b.stars - a.stars),
    [repos.data],
  );

  async function add(e: FormEvent) {
    e.preventDefault();
    const parsed = parseRepoName(input);
    if (!parsed) {
      setInputError('That does not look like a repository. Use owner/name, or paste a github.com or codeberg.org link.');
      return;
    }
    setInputError(null);
    setAdding(true);
    try {
      const r = await api.follow(`${parsed.host === 'codeberg' ? 'codeberg.org/' : ''}${parsed.owner}/${parsed.name}`);
      repos.setData((prev) => [...(prev ?? []).filter((x) => x.id !== r.id), r]);
      setInput('');
      toast(`Now following ${r.fullName}`, 'success');
      void reloadMe();
    } catch (err) {
      fail(err);
    } finally {
      setAdding(false);
    }
  }

  async function remove(id: number, name: string) {
    if (!window.confirm(`Stop following ${name}? Its collected history will no longer be shown.`)) return;
    setRemoving(id);
    try {
      await api.unfollow(id);
      repos.setData((prev) => prev?.filter((x) => x.id !== id) ?? prev);
      void reloadMe();
    } catch (err) {
      fail(err);
    } finally {
      setRemoving(null);
    }
  }

  return (
    <>
      <PageHead
        title="Following"
        sub="Track the public stats of any repository on GitHub or Codeberg over time: stars, forks, issues and releases. No access to the repository is needed."
        actions={<UsageMeter kind="followed" variant="inline" />}
      />
      <form className="follow-form" onSubmit={(e) => void add(e)}>
        <div className="field grow">
          <label className="field-label" htmlFor="follow-input">
            Repository to follow
          </label>
          <input
            id="follow-input"
            type="text"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setInputError(null);
            }}
            placeholder="owner/name, or a github.com or codeberg.org link"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={inputError ? true : undefined}
            aria-describedby={inputError ? 'follow-error' : undefined}
          />
          {inputError && (
            <span className="field-error" id="follow-error" role="alert">
              {inputError}
            </span>
          )}
        </div>
        <button className="btn btn-primary" type="submit" disabled={adding || !input.trim()}>
          <Icon name="plus" size={14} />
          {adding ? 'Following…' : 'Follow'}
        </button>
      </form>

      {repos.error && <ErrorBox error={repos.error} onRetry={repos.reload} stale={!!repos.data} />}
      {!repos.data && !repos.error && <Skeleton height={240} />}
      {repos.data && followed.length === 0 && (
        <Empty title="You're not following any repositories yet">
          Paste a repository above to start recording its stars, forks and releases every day. Great for watching a project you depend on, or a competitor.
        </Empty>
      )}
      {followed.length > 0 && (
        <div className="table-wrap table-fit" tabIndex={0} role="region" aria-label="Followed repositories">
          <table className="table following-table">
            <thead>
              <tr>
                <th scope="col">Repository</th>
                <th scope="col" className="r">
                  Stars
                </th>
                <th scope="col" className="r" title="Change in stars over the last 30 days">
                  Stars 30d
                </th>
                <th scope="col" className="r">
                  Forks
                </th>
                <th scope="col" className="r">
                  Issues
                </th>
                <th scope="col">Latest release</th>
                <th scope="col" title="Star count over the last 30 days">
                  Trend
                </th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {followed.map((r) => (
                <tr key={r.id}>
                  <th scope="row" className="cell-name cell-fluid">
                    <div className="name-line">
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
                      {r.description && <span className="clip">{r.description}</span>}
                    </div>
                  </th>
                  <td className="r">
                    <Num v={r.stars} />
                  </td>
                  <td className="r">
                    <SignedDelta value={r.starsDelta30d} />
                  </td>
                  <td className="r">
                    <Num v={r.forks} />
                    {r.forksDelta30d !== 0 && (
                      <div className="cell-sub">
                        <SignedDelta value={r.forksDelta30d} suffix="30d" />
                      </div>
                    )}
                  </td>
                  <td className="r">
                    <Num v={r.openIssues} />
                  </td>
                  <td>
                    {r.latestRelease ? (
                      <span className="release-cell" title={r.latestRelease.publishedAt ? `${r.latestRelease.tag}, ${fmtDay(r.latestRelease.publishedAt.slice(0, 10))}` : r.latestRelease.tag}>
                        {r.latestRelease.tag}
                        {r.latestRelease.publishedAt && <div className="cell-sub muted">{relative(r.latestRelease.publishedAt)}</div>}
                      </span>
                    ) : (
                      <span className="muted">None</span>
                    )}
                  </td>
                  <td>
                    <Sparkline width={64} height={22} color="var(--s7)" data={r.starsSpark} label={`Star count over the last 30 days, now ${r.stars.toLocaleString()}`} />
                  </td>
                  <td>
                    <button type="button" className="btn btn-sm" disabled={removing === r.id} onClick={() => void remove(r.id, r.fullName)} aria-label={`Unfollow ${r.fullName}`}>
                      Unfollow
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
