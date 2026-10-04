import { useState } from 'react';
import type { RepoDetail } from '../../../shared/api.ts';
import { bytes, exact, fmtDay } from '../../lib/format.ts';
import { Icon } from '../../components/Icon.tsx';
import { Card, Num } from '../../components/ui.tsx';

export function ReleasesCard({ repo: d }: { repo: RepoDetail }) {
  const [all, setAll] = useState(false);
  return (
    <Card title="Releases" sub={`${d.releases.length} release${d.releases.length === 1 ? '' : 's'}, ${exact(d.releaseDownloads)} downloads`}>
      {d.releases.length === 0 ? (
        <p className="muted pad">No releases published.</p>
      ) : (
        <>
          <ul className="releases">
            {(all ? d.releases : d.releases.slice(0, 6)).map((r) => (
              <li key={r.id}>
                <details>
                  <summary>
                    <span className="rel-tag">
                      <a href={r.htmlUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                        {r.name || r.tag}
                      </a>
                      {r.prerelease && <span className="marker">Pre-release</span>}
                      {r.name && r.name !== r.tag && <span className="muted"> {r.tag}</span>}
                    </span>
                    <span className="rel-date muted">{r.publishedAt ? fmtDay(r.publishedAt.slice(0, 10)) : 'Draft'}</span>
                    <span className="rel-dl" title={`${exact(r.downloads)} downloads`}>
                      <Icon name="download" size={13} /> <Num v={r.downloads} />
                    </span>
                  </summary>
                  {r.assets.length === 0 ? (
                    <p className="muted pad">No downloadable assets.</p>
                  ) : (
                    <ul className="assets">
                      {r.assets.map((a) => (
                        <li key={a.name}>
                          <span className="clip">{a.name}</span>
                          <span className="muted">{bytes(a.size)}</span>
                          <span className="num">{exact(a.downloads)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </details>
              </li>
            ))}
          </ul>
          {d.releases.length > 6 && (
            <button type="button" className="btn btn-sm btn-quiet" onClick={() => setAll((v) => !v)}>
              {all ? 'Show fewer' : `Show all ${d.releases.length}`}
            </button>
          )}
        </>
      )}
    </Card>
  );
}
