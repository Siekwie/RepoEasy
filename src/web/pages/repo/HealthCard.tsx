import type { RepoHealth } from '../../../shared/api.ts';
import { Icon } from '../../components/Icon.tsx';
import { HEALTH_CHECKS, HealthPill } from '../../components/repo.tsx';
import { Card } from '../../components/ui.tsx';

export function HealthCard({ health }: { health: RepoHealth }) {
  return (
    <Card title="Health" sub="Quick checks that make a repository easier to find and trust">
      <div className="health-summary">
        <HealthPill health={health} />
        <span className="muted">{health.issues.length === 0 ? 'Everything checks out.' : `${health.issues.length} to fix`}</span>
      </div>
      <ul className="checklist">
        {HEALTH_CHECKS.map((c) => {
          const bad = health.issues.includes(c.issue);
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
  );
}
