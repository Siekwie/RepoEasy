import type {
  BadgeMetric,
  CiState,
  Commit,
  FeedEvent,
  Me,
  MetricPoint,
  MetricSeries,
  Overview,
  PathRow,
  PopularList,
  PublicRepoStats,
  Range,
  ReferrerRow,
  Release,
  RepoDetail,
  RepoHealth,
  RepoRelation,
  RepoSummary,
  SyncStatus,
  TrafficPoint,
  TrafficSeries,
  TrafficTotals,
} from '../shared/api.ts';
import { config, effectivePlan, planLimits } from './config.ts';
import { addDays, dayOf, type DB, type RepoRow, type UserRepoRow, type UserRow } from './db.ts';
import { syncProgress, userSettings } from './sync.ts';

const RANGE_DAYS: Record<Exclude<Range, 'all'>, number> = { '14d': 14, '30d': 30, '90d': 90, '1y': 365 };

export function parseRange(value: string | undefined, fallback: Range = '30d'): Range {
  return value === 'all' || (value !== undefined && value in RANGE_DAYS) ? (value as Range) : fallback;
}

/** First day of a range ending today, or null for `all`. */
function rangeStart(range: Range, today = dayOf()): string | null {
  return range === 'all' ? null : addDays(today, -(RANGE_DAYS[range] - 1));
}

const json = <T>(text: string, fallback: T): T => {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
};

const ZERO: TrafficTotals = { views: 0, uniques: 0, clones: 0, cloneUniques: 0 };

/** SQL fragment + params selecting a set of repo ids. */
interface RepoSet {
  sql: string;
  params: unknown[];
}
const oneRepo = (id: number): RepoSet => ({ sql: '(?)', params: [id] });
/** Own repos whose traffic the user may see. */
const trafficRepos = (userId: number): RepoSet => ({
  sql: `(SELECT repo_id FROM user_repos WHERE user_id = ? AND gone = 0 AND can_push = 1 AND relation != 'followed')`,
  params: [userId],
});
const ownRepos = (userId: number): RepoSet => ({
  sql: `(SELECT repo_id FROM user_repos WHERE user_id = ? AND gone = 0 AND relation != 'followed')`,
  params: [userId],
});

function totalsBetween(db: DB, set: RepoSet, from: string | null, to: string): TrafficTotals {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(views), 0) views, COALESCE(SUM(uniques), 0) uniques,
              COALESCE(SUM(clones), 0) clones, COALESCE(SUM(clone_uniques), 0) cloneUniques
       FROM traffic_daily WHERE repo_id IN ${set.sql} AND day <= ? AND (? IS NULL OR day >= ?)`,
    )
    .get(...set.params, to, from, from) as TrafficTotals;
  return row;
}

function firstTrafficDay(db: DB, set: RepoSet): string | null {
  return (db.prepare(`SELECT MIN(day) d FROM traffic_daily WHERE repo_id IN ${set.sql}`).get(...set.params) as { d: string | null }).d;
}

export function trafficSeries(db: DB, set: RepoSet, range: Range): TrafficSeries {
  const today = dayOf();
  const start = rangeStart(range, today) ?? firstTrafficDay(db, set) ?? addDays(today, -13);
  const rows = db
    .prepare(
      `SELECT day, SUM(views) views, SUM(uniques) uniques, SUM(clones) clones, SUM(clone_uniques) cloneUniques
       FROM traffic_daily WHERE repo_id IN ${set.sql} AND day >= ? AND day <= ? GROUP BY day`,
    )
    .all(...set.params, start, today) as TrafficPoint[];
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const points: TrafficPoint[] = [];
  const totals = { ...ZERO };
  for (let day = start; day <= today; day = addDays(day, 1)) {
    const p = byDay.get(day) ?? { day, ...ZERO };
    points.push(p);
    totals.views += p.views;
    totals.uniques += p.uniques;
    totals.clones += p.clones;
    totals.cloneUniques += p.cloneUniques;
  }
  const previous =
    range === 'all' ? null : totalsBetween(db, set, addDays(start, -RANGE_DAYS[range]), addDays(start, -1));
  return { range, points, totals, previous };
}

/**
 * Star counts for the time before daily snapshots began, reconstructed by
 * walking the per-day star history backwards from the first snapshot.
 */
function backfilledStars(db: DB, set: RepoSet, since: string | null = null): Map<number, Array<{ day: string; stars: number }>> {
  // SQLite returns the other columns from the row that holds MIN(day)
  const firsts = db
    .prepare(`SELECT repo_id, MIN(day) day, stars FROM metrics_daily WHERE repo_id IN ${set.sql} AND stars IS NOT NULL GROUP BY repo_id`)
    .all(...set.params) as Array<{ repo_id: number; day: string; stars: number }>;
  const history = db
    .prepare(`SELECT repo_id, day, new_stars FROM star_history WHERE repo_id IN ${set.sql} AND (? IS NULL OR day >= ?) ORDER BY day DESC`)
    .all(...set.params, since, since) as Array<{ repo_id: number; day: string; new_stars: number }>;
  const result = new Map<number, Array<{ day: string; stars: number }>>();
  const running = new Map(firsts.map((f) => [f.repo_id, f]));
  for (const h of history) {
    const state = running.get(h.repo_id);
    if (!state || h.day >= state.day) continue;
    // state.stars is the count at the end of day h; before that day it was lower by h.new_stars
    const points = result.get(h.repo_id) ?? result.set(h.repo_id, []).get(h.repo_id)!;
    points.push({ day: h.day, stars: Math.max(state.stars, 0) });
    running.set(h.repo_id, { ...state, day: h.day, stars: state.stars - h.new_stars });
  }
  for (const [repoId, points] of result) {
    const state = running.get(repoId)!;
    points.push({ day: addDays(state.day, -1), stars: Math.max(state.stars, 0) });
    points.reverse();
  }
  return result;
}

const emptyMetric = (day: string, stars: number): MetricPoint => ({
  day,
  stars,
  forks: null,
  watchers: null,
  openIssues: null,
  openPrs: null,
  releaseDownloads: null,
  backfilled: true,
});

export function metricSeries(db: DB, repoId: number, range: Range): MetricSeries {
  const start = rangeStart(range);
  const snapshots = db
    .prepare(
      `SELECT day, stars, forks, watchers, open_issues openIssues, open_prs openPrs, release_downloads releaseDownloads
       FROM metrics_daily WHERE repo_id = ? AND (? IS NULL OR day >= ?) ORDER BY day`,
    )
    .all(repoId, start, start) as MetricPoint[];
  const history = backfilledStars(db, oneRepo(repoId)).get(repoId) ?? [];
  const backfill = history.filter((p) => !start || p.day >= start).map((p) => emptyMetric(p.day, p.stars));
  // carry the last value from before the range in, so the line starts at the left edge
  const before = start ? history.filter((p) => p.day < start).at(-1) : undefined;
  const firstDay = backfill[0]?.day ?? snapshots[0]?.day;
  if (before && start && firstDay !== start) backfill.unshift(emptyMetric(start, before.stars));
  return { range, points: [...backfill, ...snapshots] };
}

/**
 * Referrers/paths only exist as 14-day rolling totals. `14d` returns the latest
 * snapshot; `all` sums snapshots spaced 14 days apart, which tiles the archived
 * period without double counting.
 */
function popular<T extends { count: number; uniques: number }>(
  db: DB,
  table: 'referrers_snap' | 'paths_snap',
  keyColumns: string,
  set: RepoSet,
  range: '14d' | 'all',
  limit: number,
): PopularList<T> {
  const key = keyColumns.split(',')[0]!.trim();
  const days = (
    db.prepare(`SELECT DISTINCT day FROM ${table} WHERE repo_id IN ${set.sql} ORDER BY day DESC`).all(...set.params) as Array<{ day: string }>
  ).map((r) => r.day);
  const latest = days[0];
  if (!latest) return { range, since: null, rows: [] };

  const chosen = [latest];
  if (range === 'all') {
    let target = addDays(latest, -14);
    for (const day of days) {
      if (day <= target) {
        chosen.push(day);
        target = addDays(day, -14);
      }
    }
  }
  const rows = db
    .prepare(
      `SELECT ${keyColumns.replace(/title/, 'MAX(title) title')}, SUM(count) count, SUM(uniques) uniques FROM ${table}
       WHERE repo_id IN ${set.sql} AND day IN (${chosen.map(() => '?').join(',')})
       GROUP BY ${key} ORDER BY count DESC LIMIT ?`,
    )
    .all(...set.params, ...chosen, limit) as T[];
  return { range, since: addDays(chosen[chosen.length - 1]!, -13), rows };
}

export const referrers = (db: DB, set: RepoSet, range: '14d' | 'all', limit = 50) =>
  popular<ReferrerRow>(db, 'referrers_snap', 'referrer', set, range, limit);
/**
 * Referrers summed over several repos. Each repo is tiled on its own snapshot
 * days: repos are not all synced on the same days.
 */
export function referrersAcross(db: DB, set: RepoSet, range: '14d' | 'all', limit: number): ReferrerRow[] {
  const ids = db.prepare(`SELECT DISTINCT repo_id FROM referrers_snap WHERE repo_id IN ${set.sql}`).all(...set.params) as Array<{ repo_id: number }>;
  const merged = new Map<string, ReferrerRow>();
  for (const { repo_id } of ids) {
    for (const row of referrers(db, oneRepo(repo_id), range, 1000).rows) {
      const entry = merged.get(row.referrer) ?? { referrer: row.referrer, count: 0, uniques: 0 };
      entry.count += row.count;
      entry.uniques += row.uniques;
      merged.set(row.referrer, entry);
    }
  }
  return [...merged.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

export const paths = (db: DB, set: RepoSet, range: '14d' | 'all', limit = 50) =>
  popular<PathRow>(db, 'paths_snap', 'path, title', set, range, limit);

export function repoHealth(r: RepoRow): RepoHealth {
  const issues: RepoHealth['issues'] = [];
  let score = 100;
  const add = (issue: RepoHealth['issues'][number], cost: number) => {
    issues.push(issue);
    score -= cost;
  };
  if (!r.description) add('no-description', 15);
  if (!r.has_readme) add('no-readme', 20);
  if (!r.private && !r.license) add('no-license', 15);
  if (!r.private && json<string[]>(r.topics_json, []).length === 0) add('no-topics', 10);
  if (!r.archived && r.pushed_at && Date.now() - Date.parse(r.pushed_at) > 365 * 86_400_000) add('stale', 20);
  if (r.ci_state === 'FAILURE' || r.ci_state === 'ERROR') add('ci-failing', 20);
  return { score: Math.max(score, 0), issues };
}

type LinkRow = RepoRow & Pick<UserRepoRow, 'relation' | 'can_push' | 'can_admin' | 'tracked' | 'pinned' | 'hidden' | 'tags_json' | 'note'>;

export function getLink(db: DB, userId: number, repoId: number): LinkRow | undefined {
  return db
    .prepare(
      `SELECT r.*, ur.relation, ur.can_push, ur.can_admin, ur.tracked, ur.pinned, ur.hidden, ur.tags_json, ur.note
       FROM user_repos ur JOIN repos r ON r.id = ur.repo_id
       WHERE ur.user_id = ? AND ur.repo_id = ? AND ur.gone = 0`,
    )
    .get(userId, repoId) as LinkRow | undefined;
}

/** Summaries for all of a user's repos, or just one. */
export function repoSummaries(db: DB, userId: number, onlyRepoId?: number): RepoSummary[] {
  const today = dayOf();
  const set: RepoSet = onlyRepoId
    ? oneRepo(onlyRepoId)
    : { sql: '(SELECT repo_id FROM user_repos WHERE user_id = ? AND gone = 0)', params: [userId] };
  const links = db
    .prepare(
      `SELECT r.*, ur.relation, ur.can_push, ur.can_admin, ur.tracked, ur.pinned, ur.hidden, ur.tags_json, ur.note
       FROM user_repos ur JOIN repos r ON r.id = ur.repo_id
       WHERE ur.user_id = ? AND ur.gone = 0 ${onlyRepoId ? 'AND ur.repo_id = ?' : ''}
       ORDER BY ur.pinned DESC, r.pushed_at DESC`,
    )
    .all(...(onlyRepoId ? [userId, onlyRepoId] : [userId])) as LinkRow[];

  const group = <T extends { repo_id: number }>(rows: T[]) => {
    const map = new Map<number, T[]>();
    for (const row of rows) (map.get(row.repo_id) ?? map.set(row.repo_id, []).get(row.repo_id)!).push(row);
    return map;
  };
  type Totals = TrafficTotals & { repo_id: number; since: string | null };
  const totalsSql = (where: string) =>
    `SELECT repo_id, SUM(views) views, SUM(uniques) uniques, SUM(clones) clones, SUM(clone_uniques) cloneUniques, MIN(day) since
     FROM traffic_daily WHERE repo_id IN ${set.sql} ${where} GROUP BY repo_id`;
  const lifetime = new Map((db.prepare(totalsSql('')).all(...set.params) as Totals[]).map((t) => [t.repo_id, t]));
  const recent = new Map(
    (db.prepare(totalsSql('AND day >= ?')).all(...set.params, addDays(today, -13)) as Totals[]).map((t) => [t.repo_id, t]),
  );
  const sparkStart = addDays(today, -29);
  const views = group(
    db.prepare(`SELECT repo_id, day, views FROM traffic_daily WHERE repo_id IN ${set.sql} AND day >= ?`).all(...set.params, sparkStart) as Array<{ repo_id: number; day: string; views: number }>,
  );
  const metrics = group(
    db
      .prepare(`SELECT repo_id, day, stars, forks FROM metrics_daily WHERE repo_id IN ${set.sql} AND day >= ? AND stars IS NOT NULL ORDER BY day`)
      .all(...set.params, addDays(today, -30)) as Array<{ repo_id: number; day: string; stars: number; forks: number | null }>,
  );
  const pick = ({ views, uniques, clones, cloneUniques }: TrafficTotals): TrafficTotals => ({ views, uniques, clones, cloneUniques });
  // star history covers the part of the last 30 days from before tracking began
  const starHistory = backfilledStars(db, set, addDays(today, -31));
  /** Daily values from sparkStart to today, carrying the last known value forward. */
  const dailyStars = (points: Array<{ day: string; stars: number }>): number[] => {
    const out: number[] = [];
    let i = 0;
    let value: number | null = null;
    for (let day = sparkStart; day <= today; day = addDays(day, 1)) {
      while (i < points.length && points[i]!.day <= day) value = points[i++]!.stars;
      if (value !== null) out.push(value);
    }
    return out;
  };

  return links.map((r) => {
    const hasTraffic = Boolean(r.can_push) && r.relation !== 'followed';
    const life = lifetime.get(r.id);
    const snaps = metrics.get(r.id) ?? [];
    const viewsByDay = new Map((views.get(r.id) ?? []).map((v) => [v.day, v.views]));
    const first = snaps[0];
    const starsSpark = dailyStars([...(starHistory.get(r.id) ?? []), ...snaps]);
    return {
      id: r.id,
      fullName: r.full_name,
      owner: r.owner,
      name: r.name,
      htmlUrl: r.html_url,
      description: r.description,
      private: Boolean(r.private),
      fork: Boolean(r.fork),
      archived: Boolean(r.archived),
      language: r.language,
      languageColor: r.language_color,
      topics: json<string[]>(r.topics_json, []),
      license: r.license,
      relation: r.relation as RepoRelation,
      canPush: Boolean(r.can_push),
      canAdmin: Boolean(r.can_admin) && r.relation !== 'followed',
      tracked: Boolean(r.tracked),
      pinned: Boolean(r.pinned),
      hidden: Boolean(r.hidden),
      tags: json<string[]>(r.tags_json, []),
      note: r.note,
      shareEnabled: Boolean(r.share_enabled),
      stars: r.stars,
      forks: r.forks,
      watchers: r.watchers,
      openIssues: r.open_issues,
      openPrs: r.open_prs,
      releaseDownloads: r.release_downloads,
      commitCount: r.commit_count,
      ciState: r.ci_state as CiState,
      latestRelease: r.latest_release_tag ? { tag: r.latest_release_tag, publishedAt: r.latest_release_at } : null,
      createdAt: r.created_at_gh,
      pushedAt: r.pushed_at,
      starsDelta30d: starsSpark.length ? r.stars - starsSpark[0]! : 0,
      forksDelta30d: first ? r.forks - (first.forks ?? r.forks) : 0,
      traffic14d: hasTraffic ? pick(recent.get(r.id) ?? ZERO) : null,
      trafficLifetime: hasTraffic ? pick(life ?? ZERO) : null,
      trafficSince: hasTraffic ? (life?.since ?? null) : null,
      viewsSpark: hasTraffic ? Array.from({ length: 30 }, (_, i) => viewsByDay.get(addDays(sparkStart, i)) ?? 0) : [],
      starsSpark,
      health: repoHealth(r),
      lastSyncedAt: r.meta_synced_at,
    };
  });
}

export const shareUrls = (r: Pick<RepoRow, 'owner' | 'name'>) => ({
  pageUrl: `${config.baseUrl}/s/${r.owner}/${r.name}`,
  badges: Object.fromEntries(
    (['views', 'visitors', 'clones', 'stars', 'downloads'] as BadgeMetric[]).map((m) => [
      m,
      `${config.baseUrl}/badge/${r.owner}/${r.name}/${m}.svg`,
    ]),
  ) as Record<BadgeMetric, string>,
});

export function releasesOf(db: DB, repoId: number): Release[] {
  const rows = db
    .prepare('SELECT * FROM releases WHERE repo_id = ? ORDER BY published_at DESC')
    .all(repoId) as Array<{ release_id: number; tag: string; name: string | null; published_at: string | null; prerelease: number; downloads: number; html_url: string; assets_json: string }>;
  return rows.map((r) => ({
    id: r.release_id,
    tag: r.tag,
    name: r.name,
    publishedAt: r.published_at,
    prerelease: Boolean(r.prerelease),
    downloads: r.downloads,
    htmlUrl: r.html_url,
    assets: json<Release['assets']>(r.assets_json, []),
  }));
}

export function repoDetail(db: DB, userId: number, repoId: number): RepoDetail | null {
  const summary = repoSummaries(db, userId, repoId)[0];
  const row = getLink(db, userId, repoId);
  if (!summary || !row) return null;
  return {
    ...summary,
    homepage: row.homepage,
    defaultBranch: row.default_branch,
    sizeKb: row.size_kb,
    languages: json<RepoDetail['languages']>(row.languages_json, []),
    releases: releasesOf(db, repoId),
    starHistoryComplete: Boolean(row.star_backfill_done),
    share: shareUrls(row),
  };
}

export function commits(db: DB, set: RepoSet, limit: number): Commit[] {
  return db
    .prepare(
      `SELECT c.sha, c.repo_id repoId, r.full_name repoFullName, c.message, c.author_login authorLogin,
              c.author_name authorName, c.author_avatar_url authorAvatarUrl, c.committed_at committedAt, c.html_url htmlUrl
       FROM commits c JOIN repos r ON r.id = c.repo_id
       WHERE c.repo_id IN ${set.sql} ORDER BY c.committed_at DESC LIMIT ?`,
    )
    .all(...set.params, limit) as Commit[];
}

export function events(db: DB, userId: number, limit: number): FeedEvent[] {
  return db
    .prepare(
      `SELECT e.id, e.kind, e.repo_id repoId, r.full_name repoFullName, e.title, e.detail, e.url, e.created_at createdAt
       FROM events e LEFT JOIN repos r ON r.id = e.repo_id
       WHERE e.user_id = ? ORDER BY e.id DESC LIMIT ?`,
    )
    .all(userId, limit) as FeedEvent[];
}

export function overview(db: DB, userId: number, range: Range): Overview {
  const today = dayOf();
  const own = ownRepos(userId);
  const visible = trafficRepos(userId);
  const start = rangeStart(range, today);

  const counts = db
    .prepare(
      `SELECT COUNT(*) FILTER (WHERE ur.relation != 'followed') repoCount,
              COUNT(*) FILTER (WHERE ur.relation != 'followed' AND ur.tracked = 1) trackedCount,
              COUNT(*) FILTER (WHERE ur.relation = 'followed') followedCount,
              COALESCE(SUM(r.stars) FILTER (WHERE ur.relation != 'followed'), 0) stars,
              COALESCE(SUM(r.forks) FILTER (WHERE ur.relation != 'followed'), 0) forks,
              COALESCE(SUM(r.open_issues) FILTER (WHERE ur.relation != 'followed'), 0) openIssues,
              COALESCE(SUM(r.open_prs) FILTER (WHERE ur.relation != 'followed'), 0) openPrs,
              COALESCE(SUM(r.release_downloads) FILTER (WHERE ur.relation != 'followed'), 0) releaseDownloads
       FROM user_repos ur JOIN repos r ON r.id = ur.repo_id WHERE ur.user_id = ? AND ur.gone = 0`,
    )
    .get(userId) as Pick<Overview, 'repoCount' | 'trackedCount' | 'followedCount' | 'stars' | 'forks' | 'openIssues' | 'openPrs' | 'releaseDownloads'>;

  // Total stars per day. Repos without a snapshot on a given day carry their last known value forward.
  const snapshots = db
    .prepare(`SELECT repo_id, day, stars FROM metrics_daily WHERE repo_id IN ${own.sql} AND stars IS NOT NULL ORDER BY day`)
    .all(...own.params) as Array<{ repo_id: number; day: string; stars: number }>;
  // prepend the backfilled history; it always predates a repo's first snapshot
  const history: typeof snapshots = [];
  for (const [repo_id, points] of backfilledStars(db, own)) for (const p of points) history.push({ repo_id, ...p });
  snapshots.unshift(...history);
  snapshots.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const lastKnown = new Map<number, number>();
  const starSeries: Overview['starSeries'] = [];
  let sum = 0;
  // A repo counts with its earliest known value before its first data point;
  // otherwise repos without history would look like a jump on the day tracking began.
  for (const s of snapshots) {
    if (lastKnown.has(s.repo_id)) continue;
    lastKnown.set(s.repo_id, s.stars);
    sum += s.stars;
  }
  for (let i = 0; i < snapshots.length; i++) {
    const s = snapshots[i]!;
    sum += s.stars - (lastKnown.get(s.repo_id) ?? 0);
    lastKnown.set(s.repo_id, s.stars);
    if (snapshots[i + 1]?.day !== s.day) starSeries.push({ day: s.day, stars: sum });
  }
  const inRange = starSeries.filter((p) => !start || p.day >= start);
  const carried = start ? starSeries.filter((p) => p.day < start).at(-1) : undefined;
  if (carried && start && inRange[0]?.day !== start) inRange.unshift({ day: start, stars: carried.stars });
  const baseline = inRange[0]?.stars ?? counts.stars;

  const top = <T>(column: 'views' | 'clones', second: string) =>
    db
      .prepare(
        `SELECT r.id, r.full_name fullName, SUM(t.${column}) ${column}, SUM(t.${second === 'uniques' ? 'uniques' : 'clone_uniques'}) ${second}
         FROM traffic_daily t JOIN repos r ON r.id = t.repo_id
         WHERE t.repo_id IN ${visible.sql} AND (? IS NULL OR t.day >= ?)
         GROUP BY r.id HAVING SUM(t.${column}) > 0 ORDER BY ${column} DESC LIMIT 8`,
      )
      .all(...visible.params, start, start) as T[];

  const calendarStart = addDays(today, -370);
  const commitDays = new Map(
    (
      db
        .prepare(
          `SELECT substr(committed_at, 1, 10) day, COUNT(*) commits FROM commits
           WHERE repo_id IN ${own.sql} AND committed_at >= ? GROUP BY day`,
        )
        .all(...own.params, calendarStart) as Array<{ day: string; commits: number }>
    ).map((r) => [r.day, r.commits]),
  );

  const languageBytes = new Map<string, { color: string | null; bytes: number }>();
  const languageRows = db
    .prepare(`SELECT languages_json FROM repos WHERE fork = 0 AND id IN ${own.sql}`)
    .all(...own.params) as Array<{ languages_json: string }>;
  for (const row of languageRows) {
    for (const l of json<Overview['languages']>(row.languages_json, [])) {
      const entry = languageBytes.get(l.name) ?? { color: l.color, bytes: 0 };
      entry.bytes += l.bytes;
      languageBytes.set(l.name, entry);
    }
  }

  return {
    range,
    ...counts,
    starsDelta: counts.stars - baseline,
    traffic: trafficSeries(db, visible, range),
    lifetime: totalsBetween(db, visible, null, today),
    trafficSince: firstTrafficDay(db, visible),
    starSeries: inRange,
    topByViews: top('views', 'uniques'),
    topByClones: top('clones', 'cloneUniques'),
    topReferrers: referrersAcross(db, visible, range === '14d' ? '14d' : 'all', 10),
    commitCalendar: Array.from({ length: 371 }, (_, i) => {
      const day = addDays(calendarStart, i);
      return { day, commits: commitDays.get(day) ?? 0 };
    }),
    languages: [...languageBytes.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 12),
  };
}

export function syncStatus(user: UserRow): SyncStatus {
  const progress = syncProgress(user.id);
  const interval = planLimits(effectivePlan(user)).syncIntervalHours * 3_600_000;
  return {
    running: progress.running,
    step: progress.step,
    lastSyncAt: user.last_sync_at,
    lastError: user.last_sync_error,
    nextSyncAt:
      user.is_demo || user.token_invalid
        ? null
        : new Date(user.last_sync_at ? Date.parse(user.last_sync_at) + interval : Date.now()).toISOString(),
    rateLimitRemaining: user.rate_remaining,
  };
}

export function me(db: DB, user: UserRow): Me {
  const plan = effectivePlan(user);
  const usage = db
    .prepare(
      `SELECT COUNT(*) FILTER (WHERE relation != 'followed' AND tracked = 1) tracked,
              COUNT(*) FILTER (WHERE relation = 'followed') followed
       FROM user_repos WHERE user_id = ? AND gone = 0`,
    )
    .get(user.id) as { tracked: number; followed: number };
  return {
    id: user.id,
    login: user.login,
    name: user.name,
    avatarUrl: user.avatar_url,
    plan,
    isDemo: Boolean(user.is_demo),
    limits: planLimits(plan),
    usage,
    settings: userSettings(user),
    sync: syncStatus(user),
    billing: { hasSubscription: Boolean(user.stripe_subscription_id), renewsAt: user.plan_expires_at },
  };
}

/**
 * A repo that may be shown publicly: public on GitHub, sharing switched on, and
 * still administered by someone on this instance (so it can be switched off again).
 */
export function sharedRepo(db: DB, owner: string, name: string): RepoRow | undefined {
  return db
    .prepare(
      `SELECT r.* FROM repos r
       WHERE r.full_name = ? AND r.share_enabled = 1 AND r.private = 0
         AND EXISTS (SELECT 1 FROM user_repos ur WHERE ur.repo_id = r.id AND ur.can_admin = 1 AND ur.gone = 0)
       ORDER BY r.meta_synced_at DESC LIMIT 1`,
    )
    .get(`${owner}/${name}`) as RepoRow | undefined;
}

/** Stats for the public share page; null unless sharing is on. */
export function publicStats(db: DB, owner: string, name: string): PublicRepoStats | null {
  const repo = sharedRepo(db, owner, name);
  if (!repo) return null;
  const set = oneRepo(repo.id);
  return {
    fullName: repo.full_name,
    htmlUrl: repo.html_url,
    description: repo.description,
    language: repo.language,
    languageColor: repo.language_color,
    stars: repo.stars,
    forks: repo.forks,
    releaseDownloads: repo.release_downloads,
    trafficSince: firstTrafficDay(db, set),
    lifetime: totalsBetween(db, set, null, dayOf()),
    traffic: trafficSeries(db, set, '90d'),
    metrics: metricSeries(db, repo.id, 'all'),
    referrers: referrers(db, set, 'all', 10).rows,
    badges: shareUrls(repo).badges,
  };
}

export { oneRepo, ownRepos, trafficRepos, totalsBetween, type RepoSet };
