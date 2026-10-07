import { useMemo } from 'react';
import type { AdminStats, AdminUser, VisitFunnel } from '../../shared/api.ts';
import { get } from '../lib/api.ts';
import type { ChartSeries } from '../lib/chart-math.ts';
import { fmtDateTime, relative } from '../lib/format.ts';
import { useFetch, useTitle } from '../lib/hooks.ts';
import { Chart } from '../components/charts.tsx';
import { Icon } from '../components/Icon.tsx';
import { Avatar, Card, Fetched, Num, PageHead, Tile } from '../components/ui.tsx';

const PLAN_LABEL: Record<AdminUser['plan'], string> = { admin: 'Admin', pro: 'Pro', free: 'Free', selfhost: 'Full access' };

/** Share of landing-page views that reached a later step, e.g. "4.2%". */
function rate(part: number, whole: number): string {
  if (!whole) return 'no visits yet';
  const p = (part / whole) * 100;
  return `${p >= 10 || p === 0 ? Math.round(p) : p.toFixed(1)}% of visits`;
}

function FunnelCells({ f }: { f: VisitFunnel }) {
  return (
    <>
      <td className="r">
        <Num v={f.landing} />
      </td>
      <td className="r">
        <Num v={f.demo} />
      </td>
      <td className="r">
        <Num v={f.signin} />
      </td>
      <td className="r">
        <Num v={f.signup} />
      </td>
    </>
  );
}

/** The whole admin interface. Mounted by admin/main.tsx; the public app has no route to it. */
export function Admin() {
  useTitle('Admin');
  // answered by the admin interface's own listener (src/server/admin-web.ts), not by the public site
  const stats = useFetch(() => get<AdminStats>('/api/admin/stats'), []);
  const daily = stats.data?.funnel.daily;
  const series = useMemo<ChartSeries[]>(() => {
    const of = (key: keyof VisitFunnel) => (daily ?? []).map((d) => ({ day: d.day, v: d[key] }));
    return [
      { key: 'landing', label: 'Start page views', color: 'var(--s1)', type: 'area', data: of('landing') },
      { key: 'signin', label: 'Sign-ins started', color: 'var(--s2)', type: 'line', data: of('signin') },
      { key: 'signup', label: 'New accounts', color: 'var(--s3)', type: 'line', data: of('signup') },
    ];
  }, [daily]);

  return (
    <>
      <PageHead
        title="Admin"
        sub="Accounts and visits on this instance. The demo account is not counted."
        actions={
          <button type="button" className="btn btn-sm" onClick={stats.reload} disabled={stats.loading}>
            <Icon name="sync" size={14} className={stats.loading ? 'spin' : ''} /> Refresh
          </button>
        }
      />
      <Fetched f={stats} height={300}>
        {(d) => (
          <div className={stats.loading ? 'is-refreshing' : ''}>
            <section className="kpi-group" aria-labelledby="ad-accounts">
              <div className="kpi-head">
                <h2 id="ad-accounts">Accounts</h2>
                <p className="muted">As of {fmtDateTime(d.generatedAt)}</p>
              </div>
              <div className="kpis">
                <Tile label="Accounts" value={d.accounts.total} sub={`${d.accounts.new7d} new in 7 days, ${d.accounts.new30d} in 30`} />
                <Tile label="Active" value={d.accounts.active7d} sub="used the app or API in the last 7 days" />
                <Tile label="Pro" value={d.accounts.pro} sub="paying accounts" />
                <Tile label="Free" value={d.accounts.free} sub="accounts on the free plan" />
              </div>
            </section>

            <section className="kpi-group" aria-labelledby="ad-usage">
              <div className="kpi-head">
                <h2 id="ad-usage">Usage</h2>
              </div>
              <div className="kpis">
                <Tile label="Tracked repositories" value={d.repos.tracked} sub="traffic archived daily" />
                <Tile label="Followed repositories" value={d.repos.followed} />
                <Tile label="Public share pages" value={d.repos.shared} />
                <Tile label="Sync problems" value={d.accounts.problems} sub={d.accounts.problems ? 'see the accounts below' : 'every account is syncing'} />
              </div>
            </section>

            <section className="kpi-group" aria-labelledby="ad-funnel">
              <div className="kpi-head">
                <h2 id="ad-funnel">Visits, last {d.funnel.days} days</h2>
                <p className="muted">Counted on this server without cookies. Each number counts events, not people.</p>
              </div>
              <div className="kpis">
                <Tile label="Start page views" value={d.funnel.totals.landing} sub="signed-out visitors" />
                <Tile label="Demo opened" value={d.funnel.totals.demo} sub={rate(d.funnel.totals.demo, d.funnel.totals.landing)} />
                <Tile label="Sign-ins started" value={d.funnel.totals.signin} sub={rate(d.funnel.totals.signin, d.funnel.totals.landing)} hint="Includes existing accounts signing in again." />
                <Tile label="New accounts" value={d.funnel.totals.signup} sub={rate(d.funnel.totals.signup, d.funnel.totals.landing)} />
              </div>
            </section>

            <Card title="Visits per day" sub="UTC days">
              <Chart series={series} ariaLabel={`Start page views, sign-ins started and new accounts per day, last ${d.funnel.days} days`} table empty="No visits counted yet." />
            </Card>

            <Card title="Where visitors come from" sub={`Last ${d.funnel.days} days. Add ?ref=name to a link you post to see it here by that name.`}>
              {d.funnel.sources.length === 0 ? (
                <p className="muted pad">No visits counted yet.</p>
              ) : (
                <div className="table-wrap">
                  <table className="table table-compact">
                    <thead>
                      <tr>
                        <th scope="col">Source</th>
                        <th scope="col" className="r">
                          Views
                        </th>
                        <th scope="col" className="r">
                          Demo
                        </th>
                        <th scope="col" className="r">
                          Sign-ins
                        </th>
                        <th scope="col" className="r">
                          New accounts
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.funnel.sources.map((s) => (
                        <tr key={s.source}>
                          <th scope="row">{s.source || <span className="muted">Direct or unknown</span>}</th>
                          <FunnelCells f={s} />
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card title="Accounts" sub={d.accounts.total > d.users.length ? `Newest ${d.users.length} of ${d.accounts.total}` : 'Newest first'}>
              {d.users.length === 0 ? (
                <p className="muted pad">Nobody has signed up yet.</p>
              ) : (
                <div className="table-wrap">
                  <table className="table table-compact">
                    <thead>
                      <tr>
                        <th scope="col">Account</th>
                        <th scope="col">Plan</th>
                        <th scope="col">Joined</th>
                        <th scope="col">From</th>
                        <th scope="col">Last active</th>
                        <th scope="col" className="r">
                          Tracked
                        </th>
                        <th scope="col" className="r">
                          Followed
                        </th>
                        <th scope="col">Sync</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.users.map((u) => (
                        <tr key={u.id}>
                          <th scope="row">
                            <a className="admin-user" href={`https://github.com/${u.login}`} target="_blank" rel="noreferrer">
                              <Avatar src={u.avatarUrl} name={u.login} size={22} />
                              {u.login}
                            </a>
                          </th>
                          <td>{PLAN_LABEL[u.plan]}</td>
                          <td title={fmtDateTime(u.createdAt)}>{relative(u.createdAt)}</td>
                          <td>{u.source || <span className="muted">{u.source === '' ? 'Direct' : 'Unknown'}</span>}</td>
                          <td title={u.lastSeenAt ? fmtDateTime(u.lastSeenAt) : undefined}>{u.lastSeenAt ? relative(u.lastSeenAt) : <span className="muted">Never</span>}</td>
                          <td className="r">
                            <Num v={u.tracked} />
                          </td>
                          <td className="r">
                            <Num v={u.followed} />
                          </td>
                          <td>
                            {u.problem ? (
                              <span className="sync-error" title={u.problem}>
                                <Icon name="warn" size={14} /> Failing
                              </span>
                            ) : u.lastSyncAt ? (
                              <span title={fmtDateTime(u.lastSyncAt)}>{relative(u.lastSyncAt)}</span>
                            ) : (
                              <span className="muted">Not yet</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        )}
      </Fetched>
    </>
  );
}
