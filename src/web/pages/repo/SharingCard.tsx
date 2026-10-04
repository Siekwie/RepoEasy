import { Link } from 'react-router-dom';
import type { BadgeMetric, RepoDetail, RepoPatch, RepoSummary } from '../../../shared/api.ts';
import { useApp } from '../../context.tsx';
import { Icon } from '../../components/Icon.tsx';
import { Card, CopyButton, Switch } from '../../components/ui.tsx';

const BADGES: Array<{ metric: BadgeMetric; label: string }> = [
  { metric: 'views', label: 'Views' },
  { metric: 'visitors', label: 'Visitors' },
  { metric: 'clones', label: 'Clones' },
  { metric: 'stars', label: 'Stars' },
  { metric: 'downloads', label: 'Downloads' },
];

export function SharingCard({ repo: d, busy, onPatch }: { repo: RepoDetail; busy: boolean; onPatch: (p: RepoPatch) => Promise<RepoSummary | null> }) {
  const { me } = useApp();
  const sharePages = me?.limits.sharePages ?? false;
  return (
    <Card
      title="Sharing"
      sub="A public page with lifetime totals and charts, plus README badges. Visitors need no account."
      actions={
        <Switch
          checked={d.shareEnabled}
          busy={busy}
          disabled={!d.canAdmin || ((!sharePages || d.private) && !d.shareEnabled)}
          onChange={(v) => void onPatch({ shareEnabled: v })}
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
  );
}
