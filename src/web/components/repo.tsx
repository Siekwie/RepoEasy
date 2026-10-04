import type { CiState, RepoHealth, RepoSummary } from '../../shared/api.ts';
import { Icon } from './Icon.tsx';

const CI: Record<NonNullable<CiState>, { label: string; cls: string; icon: string }> = {
  SUCCESS: { label: 'Passing', cls: 'ok', icon: '✓' },
  FAILURE: { label: 'Failing', cls: 'bad', icon: '✕' },
  ERROR: { label: 'Error', cls: 'bad', icon: '✕' },
  PENDING: { label: 'Running', cls: 'warn', icon: '…' },
  EXPECTED: { label: 'Expected', cls: 'warn', icon: '…' },
};

export function CiBadge({ state }: { state: CiState }) {
  if (!state) return <span className="muted">–</span>;
  const c = CI[state];
  return (
    <span className={`ci ci-${c.cls}`} title={`Latest CI status: ${c.label}`}>
      <span aria-hidden="true">{c.icon}</span> {c.label}
    </span>
  );
}

export function RepoMarkers({ repo }: { repo: Pick<RepoSummary, 'private' | 'fork' | 'archived'> }) {
  return (
    <>
      {repo.private && (
        <span className="marker" title="Private repository">
          <Icon name="lock" size={12} /> Private
        </span>
      )}
      {repo.fork && (
        <span className="marker" title="Fork">
          <Icon name="fork" size={12} /> Fork
        </span>
      )}
      {repo.archived && (
        <span className="marker" title="Archived on GitHub">
          <Icon name="archive" size={12} /> Archived
        </span>
      )}
    </>
  );
}

export function HealthPill({ health }: { health: RepoHealth }) {
  const s = Math.round(health.score);
  const cls = s >= 80 ? 'ok' : s >= 50 ? 'warn' : 'bad';
  return (
    <span className={`health health-${cls}`} title={health.issues.length ? `${health.issues.length} thing${health.issues.length === 1 ? '' : 's'} to fix` : 'Nothing to fix'}>
      <span className="health-bar" aria-hidden="true">
        <span style={{ width: `${Math.max(4, s)}%` }} />
      </span>
      <span className="num">{s}</span>
    </span>
  );
}

export const HEALTH_CHECKS: Array<{ issue: RepoHealth['issues'][number]; ok: string; bad: string; fix: string }> = [
  { issue: 'no-description', ok: 'Has a description', bad: 'No description', fix: 'Add a one-line description so people know what this is at a glance.' },
  { issue: 'no-readme', ok: 'Has a README', bad: 'No README', fix: 'Add a README with what it does, how to install it and a short example.' },
  { issue: 'no-license', ok: 'Has a license', bad: 'No license', fix: 'Add a LICENSE file. Without one, others cannot legally reuse your code.' },
  { issue: 'no-topics', ok: 'Has topics', bad: 'No topics', fix: 'Add a few topics so the repository shows up in GitHub search and topic pages.' },
  { issue: 'stale', ok: 'Recently active', bad: 'No recent pushes', fix: 'Push a change, or archive the repository if it is finished.' },
  { issue: 'ci-failing', ok: 'CI is not failing', bad: 'CI is failing', fix: 'Open the latest failing run on GitHub and fix or re-run it.' },
];
