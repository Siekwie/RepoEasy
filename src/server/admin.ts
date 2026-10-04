import type { AdminStats, AdminUser } from '../shared/api.ts';
import { effectivePlan, isAdmin } from './config.ts';
import { addDays, dayOf, nowIso, type DB, type UserRow } from './db.ts';
import type { VisitKind } from './visits.ts';

const DAYS = 30;
const USER_ROWS = 200;

type Funnel = Record<VisitKind, number>;
const emptyFunnel = (): Funnel => ({ landing: 0, signin: 0, demo: 0, signup: 0 });

/** Everything on the admin page: accounts, usage and the visit funnel of the last 30 days. */
export function adminStats(db: DB): AdminStats {
  const now = Date.now();
  const within = (iso: string | null, days: number) => iso !== null && now - Date.parse(iso) < days * 86_400_000;

  const rows = db
    .prepare(
      `SELECT u.*,
         (SELECT COUNT(*) FROM user_repos ur WHERE ur.user_id = u.id AND ur.gone = 0 AND ur.relation != 'followed' AND ur.tracked = 1) tracked,
         (SELECT COUNT(*) FROM user_repos ur WHERE ur.user_id = u.id AND ur.gone = 0 AND ur.relation = 'followed') followed
       FROM users u WHERE u.is_demo = 0 ORDER BY u.created_at DESC, u.id DESC`,
    )
    .all() as Array<UserRow & { tracked: number; followed: number }>;
  const users: AdminUser[] = rows.map((u) => ({
    id: u.id,
    login: u.login,
    avatarUrl: u.avatar_url,
    plan: isAdmin(u) ? 'admin' : effectivePlan(u),
    createdAt: u.created_at,
    lastSeenAt: u.last_seen_at ?? u.last_login_at,
    lastSyncAt: u.last_sync_at,
    problem: u.token_invalid ? 'GitHub access was revoked or has expired' : u.last_sync_error,
    tracked: u.tracked,
    followed: u.followed,
    source: u.signup_source,
  }));

  const since = addDays(dayOf(), -(DAYS - 1));
  const visits = db.prepare('SELECT day, kind, source, count FROM visits WHERE day >= ?').all(since) as Array<{
    day: string;
    kind: VisitKind;
    source: string;
    count: number;
  }>;
  const byDay = new Map<string, Funnel>();
  for (let i = 0; i < DAYS; i++) byDay.set(addDays(since, i), emptyFunnel());
  const bySource = new Map<string, Funnel>();
  const totals = emptyFunnel();
  for (const v of visits) {
    if (!(v.kind in totals)) continue;
    const day = byDay.get(v.day);
    if (day) day[v.kind] += v.count;
    const source = bySource.get(v.source) ?? emptyFunnel();
    source[v.kind] += v.count;
    bySource.set(v.source, source);
    totals[v.kind] += v.count;
  }

  const { shared } = db.prepare('SELECT COUNT(*) shared FROM repos WHERE share_enabled = 1 AND private = 0 AND github_id > 0').get() as {
    shared: number;
  };
  return {
    generatedAt: nowIso(),
    accounts: {
      total: users.length,
      new7d: users.filter((u) => within(u.createdAt, 7)).length,
      new30d: users.filter((u) => within(u.createdAt, 30)).length,
      active7d: users.filter((u) => within(u.lastSeenAt, 7)).length,
      pro: users.filter((u) => u.plan === 'pro').length,
      free: users.filter((u) => u.plan === 'free').length,
      problems: users.filter((u) => u.problem).length,
    },
    repos: {
      tracked: users.reduce((sum, u) => sum + u.tracked, 0),
      followed: users.reduce((sum, u) => sum + u.followed, 0),
      shared,
    },
    funnel: {
      days: DAYS,
      totals,
      daily: [...byDay].map(([day, f]) => ({ day, ...f })),
      sources: [...bySource]
        .map(([source, f]) => ({ source, ...f }))
        .sort((a, b) => b.landing - a.landing || b.signup - a.signup || a.source.localeCompare(b.source))
        .slice(0, 50),
    },
    users: users.slice(0, USER_ROWS),
  };
}
