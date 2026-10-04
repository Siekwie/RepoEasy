import type { UserSettings } from '../shared/api.ts';
import { config, effectivePlan, planLimits } from './config.ts';
import { Codeberg, fetchCodebergRepo } from './codeberg.ts';
import { dayOf, nowIso, utcIso, type DB, type RepoRow, type UserRow } from './db.ts';
import { detectEvents, deliverEvents, recordEvent } from './events.ts';
import { fetchReposByNodeId, fetchViewerRepoIds, GitHub, GitHubError, type GqlRepo } from './github.ts';
import { accessToken } from './tokens.ts';

export const DEFAULT_SETTINGS: UserSettings = {
  webhookUrl: null,
  notifyMilestones: true,
  notifySpikes: true,
  notifyReleases: true,
  autoTrackNew: true,
};

export function userSettings(user: Pick<UserRow, 'settings_json'>): UserSettings {
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(user.settings_json) as Partial<UserSettings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

interface Running {
  step: string;
  promise: Promise<void>;
}
const running = new Map<number, Running>();

export function syncProgress(userId: number): { running: boolean; step: string | null } {
  const state = running.get(userId);
  return { running: Boolean(state), step: state?.step ?? null };
}

export interface SyncDeps {
  /** Injected in tests; defaults to a client built from the user's stored token. */
  gh?: GitHub;
  /** Injected in tests to keep webhook delivery off the network. */
  fetchFn?: typeof fetch;
}

/** Starts (or joins) a sync for one user. Never rejects: failures land in users.last_sync_error. */
export function syncUser(db: DB, userId: number, deps: SyncDeps = {}): Promise<void> {
  const existing = running.get(userId);
  if (existing) return existing.promise;

  const state: Running = { step: 'Starting', promise: Promise.resolve() };
  state.promise = runSync(db, userId, deps, (step) => (state.step = step))
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      const revoked = err instanceof GitHubError && err.unauthorized;
      db.prepare('UPDATE users SET last_sync_error = ?, token_invalid = MAX(token_invalid, ?) WHERE id = ?').run(
        revoked ? 'GitHub access was revoked or expired. Sign in again to resume syncing.' : message,
        revoked ? 1 : 0,
        userId,
      );
      if (revoked) {
        // Without a working token we can no longer tell what this account may see.
        // Private repos are hidden until a new sign-in rediscovers them; nothing is deleted.
        db.prepare('UPDATE user_repos SET gone = 1 WHERE user_id = ? AND repo_id IN (SELECT id FROM repos WHERE private = 1)').run(userId);
      }
      console.error(`[sync] user ${userId} failed: ${message}`);
    })
    .finally(() => running.delete(userId));
  running.set(userId, state);
  return state.promise;
}

const canPush = (r: GqlRepo) => ['ADMIN', 'MAINTAIN', 'WRITE'].includes(r.viewerPermission ?? '');

const REPO_COLUMNS = [
  'host', 'github_id', 'node_id', 'owner', 'name', 'full_name', 'html_url', 'private', 'fork', 'archived', 'in_org',
  'description', 'homepage', 'language', 'language_color', 'languages_json', 'topics_json', 'license',
  'default_branch', 'has_readme', 'size_kb', 'stars', 'forks', 'watchers', 'open_issues', 'open_prs',
  'release_count', 'commit_count', 'ci_state', 'latest_release_tag', 'latest_release_at', 'created_at_gh',
  'pushed_at', 'meta_synced_at',
] as const;

const UPSERT_REPO = `
  INSERT INTO repos (${REPO_COLUMNS.join(', ')})
  VALUES (${REPO_COLUMNS.map((c) => `@${c}`).join(', ')})
  ON CONFLICT(github_id) DO UPDATE SET
    ${REPO_COLUMNS.filter((c) => c !== 'github_id').map((c) => `${c} = excluded.${c}`).join(', ')}
  RETURNING id`;

/** One row of the repos table, as its host reports the repository. */
export type RepoRecord = Record<(typeof REPO_COLUMNS)[number], string | number | null>;

export function repoRecord(r: GqlRepo): RepoRecord {
  const commit = r.defaultBranchRef?.target;
  return {
    host: 'github',
    github_id: r.databaseId,
    node_id: r.id,
    owner: r.owner.login,
    name: r.name,
    full_name: r.nameWithOwner,
    html_url: r.url,
    private: r.isPrivate ? 1 : 0,
    fork: r.isFork ? 1 : 0,
    archived: r.isArchived ? 1 : 0,
    in_org: r.isInOrganization ? 1 : 0,
    description: r.description || null,
    homepage: r.homepageUrl || null,
    language: r.primaryLanguage?.name ?? null,
    language_color: r.primaryLanguage?.color ?? null,
    languages_json: JSON.stringify(
      (r.languages?.edges ?? []).map((e) => ({ name: e.node.name, color: e.node.color, bytes: e.size })),
    ),
    topics_json: JSON.stringify((r.repositoryTopics?.nodes ?? []).map((n) => n.topic.name)),
    license: r.licenseInfo?.spdxId && r.licenseInfo.spdxId !== 'NOASSERTION' ? r.licenseInfo.spdxId : null,
    default_branch: r.defaultBranchRef?.name ?? null,
    has_readme: r.readmeMd || r.readmeLower || r.readmeRst || r.readmePlain ? 1 : 0,
    size_kb: r.diskUsage ?? 0,
    stars: r.stargazerCount,
    forks: r.forkCount,
    watchers: r.watchers?.totalCount ?? 0,
    open_issues: r.issues?.totalCount ?? 0,
    open_prs: r.pullRequests?.totalCount ?? 0,
    release_count: r.releases?.totalCount ?? 0,
    commit_count: commit?.history?.totalCount ?? null,
    ci_state: commit?.statusCheckRollup?.state ?? null,
    latest_release_tag: r.latestRelease?.tagName ?? null,
    latest_release_at: r.latestRelease?.publishedAt ?? null,
    created_at_gh: r.createdAt,
    pushed_at: r.pushedAt,
    meta_synced_at: nowIso(),
  };
}

/** Writes repo metadata plus today's metrics snapshot. Returns the local repo id. */
export function saveRepo(db: DB, record: RepoRecord): number {
  const row = db.prepare(UPSERT_REPO).get(record) as { id: number };

  if (record.private) {
    // Only public repos can be followed. Once a repo turns private its followers lose it,
    // and it can no longer be shared publicly.
    db.prepare(`DELETE FROM user_repos WHERE repo_id = ? AND relation = 'followed'`).run(row.id);
    db.prepare('UPDATE repos SET share_enabled = 0 WHERE id = ?').run(row.id);
  }

  db.prepare(
    `INSERT INTO metrics_daily (repo_id, day, stars, forks, watchers, open_issues, open_prs, release_downloads)
     SELECT id, @day, stars, forks, watchers, open_issues, open_prs,
            CASE WHEN detail_synced_at IS NULL THEN NULL ELSE release_downloads END
     FROM repos WHERE id = @id
     ON CONFLICT(repo_id, day) DO UPDATE SET
       stars = excluded.stars, forks = excluded.forks, watchers = excluded.watchers,
       open_issues = excluded.open_issues, open_prs = excluded.open_prs,
       release_downloads = COALESCE(excluded.release_downloads, release_downloads)`,
  ).run({ id: row.id, day: dayOf() });
  return row.id;
}

export const upsertRepo = (db: DB, r: GqlRepo): number => saveRepo(db, repoRecord(r));

/**
 * Brings an account back within its plan: untracks repos beyond the limit
 * (keeping pinned and most-viewed ones) and switches off sharing the plan no
 * longer includes. Followed repos and all history are kept.
 */
export function enforceLimits(db: DB, user: UserRow): void {
  const limits = planLimits(effectivePlan(user));
  if (!limits.sharePages) {
    // Sharing belongs to the repo, not to one account: it stays on while any other admin's plan includes it.
    const shared = db
      .prepare(
        'SELECT r.id FROM repos r JOIN user_repos ur ON ur.repo_id = r.id WHERE r.share_enabled = 1 AND ur.user_id = ? AND ur.can_admin = 1',
      )
      .all(user.id) as Array<{ id: number }>;
    const otherAdmins = db.prepare(
      `SELECT u.* FROM user_repos ur JOIN users u ON u.id = ur.user_id
       WHERE ur.repo_id = ? AND ur.user_id != ? AND ur.can_admin = 1 AND ur.gone = 0 AND ur.relation != 'followed'`,
    );
    const unshare = db.prepare('UPDATE repos SET share_enabled = 0 WHERE id = ?');
    for (const { id } of shared) {
      const covered = (otherAdmins.all(id, user.id) as UserRow[]).some((admin) => planLimits(effectivePlan(admin)).sharePages);
      if (!covered) unshare.run(id);
    }
  }
  const max = limits.trackedRepos;
  if (max === null) return;
  const tracked = db
    .prepare(
      `SELECT ur.repo_id FROM user_repos ur
       LEFT JOIN (SELECT repo_id, SUM(views) v FROM traffic_daily GROUP BY repo_id) t ON t.repo_id = ur.repo_id
       WHERE ur.user_id = ? AND ur.tracked = 1 AND ur.relation != 'followed' AND ur.gone = 0
       ORDER BY ur.pinned DESC, COALESCE(t.v, 0) DESC, ur.added_at ASC`,
    )
    .all(user.id) as Array<{ repo_id: number }>;
  const untrack = db.prepare('UPDATE user_repos SET tracked = 0 WHERE user_id = ? AND repo_id = ?');
  for (const { repo_id } of tracked.slice(max)) untrack.run(user.id, repo_id);
}

/**
 * Links the account to its repos. `nodeIds` is the authoritative list of what
 * the account can see; `repos` holds the details that could be fetched for it.
 */
function discover(db: DB, user: UserRow, nodeIds: string[], repos: GqlRepo[]): void {
  const settings = userSettings(user);
  const max = planLimits(effectivePlan(user)).trackedRepos;
  const firstSync = !user.last_sync_at;
  const now = nowIso();

  const getLink = db.prepare('SELECT relation, tracked FROM user_repos WHERE user_id = ? AND repo_id = ?');
  const insertLink = db.prepare(
    `INSERT INTO user_repos (user_id, repo_id, relation, can_push, can_admin, tracked, added_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const updateLink = db.prepare(
    `UPDATE user_repos SET relation = ?, can_push = ?, can_admin = ?, gone = 0, tracked = tracked AND ?
     WHERE user_id = ? AND repo_id = ?`,
  );
  let trackedCount = (
    db
      .prepare(`SELECT COUNT(*) n FROM user_repos WHERE user_id = ? AND tracked = 1 AND relation != 'followed' AND gone = 0`)
      .get(user.id) as { n: number }
  ).n;

  db.transaction(() => {
    for (const r of repos) {
      const repoId = upsertRepo(db, r);
      const push = canPush(r) ? 1 : 0;
      const admin = r.viewerPermission === 'ADMIN' ? 1 : 0;
      const relation =
        r.owner.login.toLowerCase() === user.login.toLowerCase() ? 'owner' : r.isInOrganization ? 'org' : 'collaborator';
      const link = getLink.get(user.id, repoId) as { relation: string; tracked: number } | undefined;
      if (link) {
        // a repo the user followed and later gained access to becomes a normal own repo
        updateLink.run(relation, push, admin, push, user.id, repoId);
        continue;
      }
      const track = settings.autoTrackNew && push && !r.isArchived && (max === null || trackedCount < max) ? 1 : 0;
      trackedCount += track;
      insertLink.run(user.id, repoId, relation, push, admin, track, now);
      if (!firstSync) {
        recordEvent(db, user.id, {
          kind: 'repo-discovered',
          repoId,
          title: `New repository ${r.nameWithOwner}`,
          detail: track ? 'Traffic archiving started automatically.' : 'Not tracked yet.',
          url: r.url,
          dedupeKey: `discovered:${repoId}`,
        });
      }
    }
    // Repos that vanished from the account keep their history; they are only hidden.
    db.prepare(
      `UPDATE user_repos SET gone = 1
       WHERE user_id = ? AND relation != 'followed'
         AND repo_id NOT IN (SELECT r.id FROM repos r WHERE r.node_id IN (SELECT value FROM json_each(?)))`,
    ).run(user.id, JSON.stringify(nodeIds));
  })();
}

async function pool<T>(items: T[], size: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  let failure: unknown = null;
  const run = async () => {
    while (failure === null && next < items.length) {
      const index = next++;
      try {
        await worker(items[index]!, index);
      } catch (err) {
        failure = err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
  if (failure !== null) throw failure;
}

/** Errors that must stop the whole sync; everything else is skipped per repo. */
const fatal = (err: unknown) => err instanceof GitHubError && (err.rateLimited || err.unauthorized);

interface TrafficResponse {
  views?: Array<{ timestamp: string; count: number; uniques: number }>;
  clones?: Array<{ timestamp: string; count: number; uniques: number }>;
}

export async function syncTraffic(db: DB, gh: GitHub, repo: RepoRow): Promise<void> {
  const base = `/repos/${repo.owner}/${repo.name}/traffic`;
  const allow = [403, 404];
  const views = await gh.rest<TrafficResponse>(`${base}/views`, { query: { per: 'day' }, allow });
  if (views.status !== 200) return; // push access was lost
  const clones = await gh.rest<TrafficResponse>(`${base}/clones`, { query: { per: 'day' }, allow });
  const referrers = await gh.rest<Array<{ referrer: string; count: number; uniques: number }>>(
    `${base}/popular/referrers`,
    { allow },
  );
  const paths = await gh.rest<Array<{ path: string; title: string; count: number; uniques: number }>>(
    `${base}/popular/paths`,
    { allow },
  );

  // MAX() because a day already archived can only ever have been reported complete or partial, never too high.
  const upsertViews = db.prepare(
    `INSERT INTO traffic_daily (repo_id, day, views, uniques) VALUES (?, ?, ?, ?)
     ON CONFLICT(repo_id, day) DO UPDATE SET views = MAX(views, excluded.views), uniques = MAX(uniques, excluded.uniques)`,
  );
  const upsertClones = db.prepare(
    `INSERT INTO traffic_daily (repo_id, day, clones, clone_uniques) VALUES (?, ?, ?, ?)
     ON CONFLICT(repo_id, day) DO UPDATE SET clones = MAX(clones, excluded.clones),
       clone_uniques = MAX(clone_uniques, excluded.clone_uniques)`,
  );
  const today = dayOf();
  db.transaction(() => {
    for (const v of views.data?.views ?? []) upsertViews.run(repo.id, v.timestamp.slice(0, 10), v.count, v.uniques);
    if (clones.status === 200) {
      for (const c of clones.data?.clones ?? []) upsertClones.run(repo.id, c.timestamp.slice(0, 10), c.count, c.uniques);
    }
    if (referrers.status === 200 && Array.isArray(referrers.data)) {
      db.prepare('DELETE FROM referrers_snap WHERE repo_id = ? AND day = ?').run(repo.id, today);
      const insert = db.prepare(
        'INSERT OR REPLACE INTO referrers_snap (repo_id, day, referrer, count, uniques) VALUES (?, ?, ?, ?, ?)',
      );
      for (const r of referrers.data) insert.run(repo.id, today, r.referrer, r.count, r.uniques);
    }
    if (paths.status === 200 && Array.isArray(paths.data)) {
      db.prepare('DELETE FROM paths_snap WHERE repo_id = ? AND day = ?').run(repo.id, today);
      const insert = db.prepare(
        'INSERT OR REPLACE INTO paths_snap (repo_id, day, path, title, count, uniques) VALUES (?, ?, ?, ?, ?, ?)',
      );
      for (const p of paths.data) insert.run(repo.id, today, p.path, p.title ?? null, p.count, p.uniques);
    }
    db.prepare('UPDATE repos SET traffic_synced_at = ? WHERE id = ?').run(nowIso(), repo.id);
  })();
}

interface RestRelease {
  id: number;
  tag_name: string;
  name: string | null;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  html_url: string;
  assets: Array<{ name: string; download_count: number; size: number }> | null;
  /** Forgejo only: downloads of the source archives it generates for the tag. */
  archive_download_count?: { zip?: number; tar_gz?: number } | null;
}

/** Forgejo (Codeberg) names the page size differently and caps it at 50. */
const pageSize = (repo: RepoRow, size: number) => (repo.host === 'github' ? { per_page: size } : { limit: Math.min(size, 50) });

export async function syncReleases(db: DB, gh: GitHub, repo: RepoRow): Promise<void> {
  const releases: RestRelease[] = [];
  let url: string | null = `/repos/${repo.owner}/${repo.name}/releases`;
  for (let page = 0; url && page < 10; page++) {
    const res: Awaited<ReturnType<typeof gh.rest<RestRelease[]>>> = await gh.rest<RestRelease[]>(url, {
      query: page === 0 ? pageSize(repo, 100) : undefined,
      allow: [403, 404],
    });
    if (res.status !== 200 || !Array.isArray(res.data)) return;
    releases.push(...res.data.filter((r) => !r.draft));
    url = res.next;
  }
  const upsert = db.prepare(
    `INSERT OR REPLACE INTO releases (repo_id, release_id, tag, name, published_at, prerelease, downloads, html_url, assets_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  let total = 0;
  db.transaction(() => {
    db.prepare('DELETE FROM releases WHERE repo_id = ?').run(repo.id);
    for (const r of releases) {
      const assets = (r.assets ?? []).map((a) => ({ name: a.name, downloads: a.download_count, size: a.size }));
      const archives = r.archive_download_count;
      if (archives) {
        assets.push(
          { name: 'Source code (zip)', downloads: archives.zip ?? 0, size: 0 },
          { name: 'Source code (tar.gz)', downloads: archives.tar_gz ?? 0, size: 0 },
        );
      }
      const downloads = assets.reduce((sum, a) => sum + a.downloads, 0);
      total += downloads;
      upsert.run(repo.id, r.id, r.tag_name, r.name, utcIso(r.published_at), r.prerelease ? 1 : 0, downloads, r.html_url, JSON.stringify(assets));
    }
    db.prepare('UPDATE repos SET release_downloads = ?, detail_synced_at = ? WHERE id = ?').run(total, nowIso(), repo.id);
    db.prepare('UPDATE metrics_daily SET release_downloads = ? WHERE repo_id = ? AND day = ?').run(total, repo.id, dayOf());
  })();
}

interface RestCommit {
  sha: string;
  html_url: string;
  commit: { message: string; author: { name: string; date: string } | null; committer: { date: string } | null };
  author: { login: string; avatar_url: string } | null;
}

/**
 * A merged or rebased branch puts commits on the default branch that are dated before the newest
 * one already stored, so each fetch reaches back this far. Rows are keyed by SHA: overlap is free.
 */
const COMMIT_OVERLAP_DAYS = 30;

export async function syncCommits(db: DB, gh: GitHub, repo: RepoRow): Promise<void> {
  const latest = (db.prepare('SELECT MAX(committed_at) m FROM commits WHERE repo_id = ?').get(repo.id) as { m: string | null }).m;
  const since = latest ? new Date(Date.parse(latest) - COMMIT_OVERLAP_DAYS * 86_400_000).toISOString() : undefined;
  const insert = db.prepare(
    `INSERT OR REPLACE INTO commits (repo_id, sha, message, author_login, author_name, author_avatar_url, committed_at, html_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  let url: string | null = `/repos/${repo.owner}/${repo.name}/commits`;
  for (let page = 0; url && page < config.sync.commitPages; page++) {
    const res: Awaited<ReturnType<typeof gh.rest<RestCommit[]>>> = await gh.rest<RestCommit[]>(url, {
      // Forgejo has no `since`, and unless told otherwise works out the changed files of every commit
      query:
        page !== 0
          ? undefined
          : repo.host === 'github'
            ? { per_page: 100, since }
            : { ...pageSize(repo, 100), stat: 'false', verification: 'false', files: 'false' },
      allow: [403, 404, 409], // 409 = empty repository
    });
    if (res.status === 409) break; // empty repository: nothing to fetch, and that is final
    if (res.status !== 200 || !Array.isArray(res.data)) return; // try again next sync
    let allKnown = Boolean(since) && res.data.length > 0;
    db.transaction(() => {
      for (const c of res.data) {
        const date = utcIso(c.commit.committer?.date ?? c.commit.author?.date);
        if (!date) continue;
        if (!since || Date.parse(date) >= Date.parse(since)) allKnown = false;
        const firstLine = c.commit.message.split('\n', 1)[0] ?? '';
        insert.run(repo.id, c.sha, firstLine.slice(0, 300), c.author?.login ?? null, c.commit.author?.name ?? null, c.author?.avatar_url ?? null, date, c.html_url);
      }
    })();
    // a whole page from before the overlap: everything further back is stored already
    if (allKnown) break;
    url = res.next;
  }
  db.prepare('UPDATE repos SET commits_pushed_at = ? WHERE id = ?').run(repo.pushed_at, repo.id);
}

/**
 * Fills star_history from GitHub's weekly star-history endpoint, newest first,
 * a bounded number of pages per sync so huge repos spread over several runs.
 */
export async function backfillStars(db: DB, gh: GitHub, repo: RepoRow): Promise<void> {
  const insert = db.prepare('INSERT OR REPLACE INTO star_history (repo_id, day, new_stars) VALUES (?, ?, ?)');
  const finish = db.prepare('UPDATE repos SET star_backfill_done = 1 WHERE id = ?');
  let page = repo.star_backfill_page;
  for (let i = 0; i < config.sync.starPages; i++, page++) {
    const res = await gh.rest<Array<{ week: number; days: number[] }>>(
      `/repos/${repo.owner}/${repo.name}/stargazers/history`,
      { query: { per_page: 30, page }, allow: [403, 404, 422] },
    );
    if (res.status !== 200 || !Array.isArray(res.data)) {
      finish.run(repo.id);
      return;
    }
    db.transaction(() => {
      for (const week of res.data) {
        week.days.forEach((count, offset) => {
          if (count > 0) insert.run(repo.id, dayOf((week.week + offset * 86_400) * 1000), count);
        });
      }
    })();
    if (!res.next || res.data.length === 0) {
      finish.run(repo.id);
      return;
    }
  }
  db.prepare('UPDATE repos SET star_backfill_page = ? WHERE id = ?').run(page, repo.id);
}

const minutesSince = (iso: string | null) => (iso ? (Date.now() - Date.parse(iso)) / 60_000 : Infinity);

/**
 * Per-repo collection: traffic (when the token has push access), releases,
 * commits and star history (GitHub only: Codeberg does not date its stars).
 * Recently collected parts are skipped, so repos shared by several accounts
 * are not fetched twice.
 */
export async function collectRepo(db: DB, gh: GitHub, repo: RepoRow, traffic: boolean): Promise<void> {
  const tasks: Array<[string, () => Promise<void>]> = [];
  if (traffic && minutesSince(repo.traffic_synced_at) > 30) {
    tasks.push(['traffic', () => syncTraffic(db, gh, repo)]);
  }
  if (repo.release_count > 0 && minutesSince(repo.detail_synced_at) > 60) {
    tasks.push(['releases', () => syncReleases(db, gh, repo)]);
  }
  if (repo.pushed_at && repo.pushed_at !== repo.commits_pushed_at) {
    tasks.push(['commits', () => syncCommits(db, gh, repo)]);
  }
  if (repo.host === 'github' && !repo.star_backfill_done && repo.stars > 0) {
    tasks.push(['star history', () => backfillStars(db, gh, repo)]);
  }
  for (const [label, task] of tasks) {
    try {
      await task();
    } catch (err) {
      if (fatal(err)) throw err;
      console.warn(`[sync] ${repo.full_name}: ${label} skipped: ${err instanceof Error ? err.message : err}`);
    }
  }
}

/**
 * Refreshes and collects followed Codeberg repositories, one at a time. Codeberg being down or
 * refusing requests never fails the account's sync: what cannot be read keeps its archived
 * numbers and is tried again next time.
 */
async function syncCodeberg(db: DB, repos: RepoRow[], cb: Codeberg, collected: () => void): Promise<void> {
  for (const repo of repos) {
    try {
      let current = repo;
      // another follower's sync may have refreshed a shared repo moments ago
      if (minutesSince(repo.meta_synced_at) > 60) {
        const record = await fetchCodebergRepo(cb, repo.owner, repo.name);
        // gone, or the name now belongs to a different repository
        if (!record || record.github_id !== repo.github_id) continue;
        current = db.prepare('SELECT * FROM repos WHERE id = ?').get(saveRepo(db, record)) as RepoRow;
      }
      if (!current.private) await collectRepo(db, cb, current, false);
    } catch (err) {
      console.warn(`[sync] codeberg ${repo.full_name}: ${err instanceof Error ? err.message : err}`);
      if (fatal(err)) return; // rate limited: the rest waits for the next sync
    } finally {
      collected();
    }
  }
}

async function runSync(db: DB, userId: number, deps: SyncDeps, step: (s: string) => void): Promise<void> {
  let user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined;
  if (!user || user.is_demo || !user.token_enc) return;
  db.prepare('UPDATE users SET last_sync_started_at = ? WHERE id = ?').run(nowIso(), userId);
  // events recorded during this run are the ones with a higher id
  const lastEventId = (db.prepare('SELECT COALESCE(MAX(id), 0) id FROM events WHERE user_id = ?').get(userId) as { id: number }).id;
  const gh = deps.gh ?? new GitHub(await accessToken(db, user, deps.fetchFn), deps.fetchFn);

  step('Discovering repositories');
  const nodeIds = await fetchViewerRepoIds(gh);
  step(`Reading ${nodeIds.length} repositories`);
  discover(db, user, nodeIds, await fetchReposByNodeId(gh, nodeIds));
  user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow;
  enforceLimits(db, user);

  step('Refreshing followed repositories');
  const followed = db
    .prepare(
      `SELECT r.node_id, r.meta_synced_at FROM user_repos ur JOIN repos r ON r.id = ur.repo_id
       WHERE ur.user_id = ? AND ur.relation = 'followed' AND r.host = 'github' AND r.node_id IS NOT NULL`,
    )
    .all(userId) as Array<{ node_id: string; meta_synced_at: string | null }>;
  // another follower's sync may have refreshed a shared repo moments ago
  const stale = followed.filter((f) => minutesSince(f.meta_synced_at) > 60).map((f) => f.node_id);
  if (stale.length) {
    const nodes = await fetchReposByNodeId(gh, stale);
    db.transaction(() => {
      for (const n of nodes) upsertRepo(db, n);
    })();
  }

  const work = db
    .prepare(
      `SELECT r.*, ur.can_push AS link_can_push, ur.relation AS link_relation FROM user_repos ur
       JOIN repos r ON r.id = ur.repo_id
       WHERE ur.user_id = ? AND ur.gone = 0 AND (ur.tracked = 1 OR ur.relation = 'followed')
       ORDER BY r.pushed_at DESC`,
    )
    .all(userId) as Array<RepoRow & { link_can_push: number; link_relation: string }>;

  let done = 0;
  const collected = () => step(`Collecting ${++done}/${work.length}`);
  const onGitHub = work.filter((r) => r.host === 'github');
  await pool(onGitHub, config.sync.concurrency, async (repo) => {
    await collectRepo(db, gh, repo, Boolean(repo.link_can_push) && repo.link_relation !== 'followed');
    collected();
  });
  const onCodeberg = work.filter((r) => r.host === 'codeberg');
  if (onCodeberg.length) await syncCodeberg(db, onCodeberg, new Codeberg(deps.fetchFn), collected);

  step('Finishing');
  detectEvents(db, userId);
  db.prepare('UPDATE users SET last_sync_at = ?, last_sync_error = NULL, rate_remaining = ? WHERE id = ?').run(
    nowIso(),
    gh.rateRemaining,
    userId,
  );
  await deliverEvents(db, user, lastEventId, deps.fetchFn);
}
