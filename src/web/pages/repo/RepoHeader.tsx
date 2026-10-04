import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { RepoDetail, RepoPatch, RepoSummary } from '../../../shared/api.ts';
import { useApp } from '../../context.tsx';
import { api } from '../../lib/api.ts';
import { bytes, fmtDateTime, fmtDay, relative } from '../../lib/format.ts';
import { Icon } from '../../components/Icon.tsx';
import { CiBadge, RepoMarkers } from '../../components/repo.tsx';
import { LangDot, Switch } from '../../components/ui.tsx';
import { TagsAndNote } from './TagsAndNote.tsx';

export function RepoHeader({ repo: d, busy, onPatch }: { repo: RepoDetail; busy: boolean; onPatch: (p: RepoPatch) => Promise<RepoSummary | null> }) {
  const followed = d.relation === 'followed';
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
                onChange={(v) => void onPatch({ tracked: v })}
                label={d.tracked ? 'Tracking traffic' : 'Track traffic'}
              />
              <button type="button" className="btn btn-sm" aria-pressed={d.pinned} disabled={busy} onClick={() => void onPatch({ pinned: !d.pinned })}>
                <Icon name="pin" size={14} /> {d.pinned ? 'Pinned' : 'Pin'}
              </button>
              <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void onPatch({ hidden: !d.hidden })}>
                <Icon name={d.hidden ? 'eye' : 'eyeoff'} size={14} /> {d.hidden ? 'Unhide' : 'Hide'}
              </button>
            </>
          )}
          {followed && <UnfollowButton id={d.id} name={d.fullName} />}
        </div>
        {!followed && <TagsAndNote repo={d} busy={busy} onPatch={onPatch} />}
      </header>
    </>
  );
}

function UnfollowButton({ id, name }: { id: number; name: string }) {
  const { fail, reloadMe } = useApp();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  return (
    <button type="button"
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
