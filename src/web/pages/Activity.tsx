import { useApp } from '../context.tsx';
import { api } from '../lib/api.ts';
import { useFetch, useTitle } from '../lib/hooks.ts';
import { CommitList, EventList } from '../components/feeds.tsx';
import { Card, Fetched, PageHead } from '../components/ui.tsx';

export function Activity() {
  useTitle('Activity');
  const { syncVersion } = useApp();
  const commits = useFetch(() => api.commits(100), [], syncVersion);
  const events = useFetch(() => api.events(100), [], syncVersion);
  return (
    <>
      <PageHead title="Activity" sub="Recent commits across your repositories, and the events RepoEasy noticed." />
      <div className="grid-2 grid-top">
        <Card title="Latest commits" sub="Across your repositories">
          <Fetched f={commits} height={300}>
            {(c) => <CommitList commits={c} />}
          </Fetched>
        </Card>
        <Card title="Events" sub="Milestones, spikes, releases and new referrers">
          <Fetched f={events} height={300}>
            {(e) => <EventList events={e} />}
          </Fetched>
        </Card>
      </div>
    </>
  );
}
