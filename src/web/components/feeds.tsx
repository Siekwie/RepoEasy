import { Link } from 'react-router-dom';
import type { Commit, EventKind, FeedEvent } from '../../shared/api.ts';
import { relative, fmtDateTime } from '../lib/format.ts';
import { Icon, type IconName } from './Icon.tsx';
import { Avatar } from './ui.tsx';

const KIND: Record<EventKind, { icon: IconName; label: string }> = {
  'star-milestone': { icon: 'star', label: 'Star milestone' },
  'traffic-spike': { icon: 'trend', label: 'Traffic spike' },
  'new-release': { icon: 'tag', label: 'New release' },
  'fork-milestone': { icon: 'fork', label: 'Fork milestone' },
  'repo-discovered': { icon: 'repos', label: 'Repository found' },
  'referrer-new': { icon: 'link', label: 'New referrer' },
};

export function EventList({ events }: { events: FeedEvent[] }) {
  if (events.length === 0) return <p className="muted pad">No events yet. Milestones, traffic spikes and new releases show up here.</p>;
  return (
    <ul className="feed">
      {events.map((e) => {
        const k = KIND[e.kind] ?? { icon: 'activity' as IconName, label: e.kind };
        return (
          <li key={e.id}>
            <span className="feed-icon" title={k.label}>
              <Icon name={k.icon} size={15} />
              <span className="sr-only">{k.label}</span>
            </span>
            <div className="feed-body">
              <div className="feed-title">
                {e.url ? (
                  <a href={e.url} target="_blank" rel="noreferrer">
                    {e.title}
                  </a>
                ) : (
                  e.title
                )}
              </div>
              <div className="feed-meta">
                {e.repoFullName && (
                  <>
                    {e.repoId != null ? <Link to={`/repos/${e.repoId}`}>{e.repoFullName}</Link> : e.repoFullName}
                    {' · '}
                  </>
                )}
                <time dateTime={e.createdAt} title={fmtDateTime(e.createdAt)}>
                  {relative(e.createdAt)}
                </time>
                {e.detail ? ` · ${e.detail}` : ''}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function CommitList({ commits, showRepo = true }: { commits: Commit[]; showRepo?: boolean }) {
  if (commits.length === 0) return <p className="muted pad">No commits to show yet.</p>;
  return (
    <ul className="feed">
      {commits.map((c) => (
        <li key={`${c.repoId}-${c.sha}`}>
          <Avatar src={c.authorAvatarUrl} name={c.authorLogin ?? c.authorName ?? '?'} size={24} />
          <div className="feed-body">
            <div className="feed-title">
              <a href={c.htmlUrl} target="_blank" rel="noreferrer">
                {c.message.split('\n')[0]}
              </a>
            </div>
            <div className="feed-meta">
              {showRepo && (
                <>
                  <Link to={`/repos/${c.repoId}`}>{c.repoFullName}</Link>
                  {' · '}
                </>
              )}
              {c.authorLogin ?? c.authorName ?? 'unknown'} ·{' '}
              <time dateTime={c.committedAt} title={fmtDateTime(c.committedAt)}>
                {relative(c.committedAt)}
              </time>{' '}
              · <code>{c.sha.slice(0, 7)}</code>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
