import { useApp } from '../context.tsx';
import { api } from '../lib/api.ts';
import { useFetch, useTitle } from '../lib/hooks.ts';
import { CommitList, EventList } from '../components/feeds.tsx';
import { Card, ErrorBox, PageHead, Skeleton } from '../components/ui.tsx';

export function Activity() {
  useTitle('Activity');
  const { syncVersion } = useApp();
  const commits = useFetch(() => api.commits(100), [syncVersion]);
  const events = useFetch(() => api.events(100), [syncVersion]);
  return (
    <>
      <PageHead title="Activity" sub="Recent commits across your repositories, and the events RepoEasy noticed." />
      <div className="grid-2 grid-top">
        <Card title="Latest commits" sub="Across your repositories">
          {commits.error && !commits.data ? <ErrorBox error={commits.error} onRetry={commits.reload} /> : commits.data ? <CommitList commits={commits.data} /> : <Skeleton height={300} />}
        </Card>
        <Card title="Events" sub="Milestones, spikes, releases and new referrers">
          {events.error && !events.data ? <ErrorBox error={events.error} onRetry={events.reload} /> : events.data ? <EventList events={events.data} /> : <Skeleton height={300} />}
        </Card>
      </div>
    </>
  );
}
