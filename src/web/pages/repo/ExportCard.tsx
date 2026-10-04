import { exportCsvPath } from '../../lib/api.ts';
import { Icon } from '../../components/Icon.tsx';
import { Card, DownloadButton } from '../../components/ui.tsx';

export function ExportCard({ id, canTraffic }: { id: number; canTraffic: boolean }) {
  const item = (kind: 'traffic' | 'metrics' | 'referrers' | 'paths', label: string) => (
    <DownloadButton path={exportCsvPath(id, kind)} fallbackName={`repo-${id}-${kind}.csv`}>
      <Icon name="download" size={14} /> {label}
    </DownloadButton>
  );
  return (
    <Card title="Export" sub="Download this repository's data as CSV">
      <div className="btn-row">
        {canTraffic && item('traffic', 'Daily traffic')}
        {item('metrics', 'Stars, forks and issues')}
        {canTraffic && (
          <>
            {item('referrers', 'Referrers')}
            {item('paths', 'Popular pages')}
          </>
        )}
      </div>
    </Card>
  );
}
