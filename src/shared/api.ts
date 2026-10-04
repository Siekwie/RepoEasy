// API contract shared by the server (src/server) and the web app (src/web).
// Types only: this file must stay free of runtime code so both sides can import it.

export type Plan = 'free' | 'pro' | 'selfhost';

/** `14d` | `30d` | `90d` | `1y` | `all` */
export type Range = '14d' | '30d' | '90d' | '1y' | 'all';

/** ISO calendar day in UTC, `YYYY-MM-DD`. */
export type Day = string;

export interface PlanLimits {
  /** Max own repos with traffic archiving on. `null` = unlimited. */
  trackedRepos: number | null;
  /** Max followed public repos. `null` = unlimited. */
  followedRepos: number | null;
  syncIntervalHours: number;
  apiTokens: boolean;
  webhooks: boolean;
  sharePages: boolean;
}

/** GET /api/info (no auth) */
export interface AppInfo {
  name: string;
  version: string;
  auth: {
    /** "Login with GitHub" is configured. */
    github: boolean;
    /**
     * Set when sign-in runs through a GitHub App: repos only show up once the app
     * is installed on them, so the UI links here ("Choose repositories on GitHub").
     */
    githubAppInstallUrl: string | null;
    /** Single-user self-host mode: POST /auth/local signs in as the configured account. */
    local: boolean;
    localNeedsPassword: boolean;
    /** POST /auth/demo signs in as a read-only demo account with sample data. */
    demo: boolean;
  };
  billing: {
    enabled: boolean;
    /** Display strings such as "$3". */
    proMonthly: string;
    proYearly: string;
  };
  limits: { free: PlanLimits; pro: PlanLimits };
}

export interface UserSettings {
  /** Discord/Slack-compatible or generic JSON webhook for events. */
  webhookUrl: string | null;
  notifyMilestones: boolean;
  notifySpikes: boolean;
  notifyReleases: boolean;
  /** Start tracking traffic for newly discovered own repos automatically. */
  autoTrackNew: boolean;
}

export interface SyncStatus {
  running: boolean;
  /** Human-readable step while running, e.g. "Traffic 12/40". */
  step: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  nextSyncAt: string | null;
  rateLimitRemaining: number | null;
}

/** GET /api/me */
export interface Me {
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  plan: Plan;
  /** Demo accounts are read-only: every mutation returns 403. */
  isDemo: boolean;
  limits: PlanLimits;
  usage: { tracked: number; followed: number };
  settings: UserSettings;
  sync: SyncStatus;
  billing: { hasSubscription: boolean; renewsAt: string | null };
}

export type RepoRelation = 'owner' | 'collaborator' | 'org' | 'followed';
export type CiState = 'SUCCESS' | 'FAILURE' | 'PENDING' | 'ERROR' | 'EXPECTED' | null;

export interface TrafficTotals {
  views: number;
  /** Sum of daily unique visitors (GitHub only reports uniques per day). */
  uniques: number;
  clones: number;
  cloneUniques: number;
}

/** One row of GET /api/repos */
export interface RepoSummary {
  id: number;
  fullName: string;
  owner: string;
  name: string;
  htmlUrl: string;
  description: string | null;
  private: boolean;
  fork: boolean;
  archived: boolean;
  language: string | null;
  languageColor: string | null;
  topics: string[];
  license: string | null;
  relation: RepoRelation;
  /** True when traffic data is collectable (push access). False for followed repos. */
  canPush: boolean;
  /** Traffic archiving is on for this repo. */
  tracked: boolean;
  pinned: boolean;
  hidden: boolean;
  tags: string[];
  note: string | null;
  shareEnabled: boolean;
  stars: number;
  forks: number;
  watchers: number;
  openIssues: number;
  openPrs: number;
  releaseDownloads: number;
  commitCount: number | null;
  ciState: CiState;
  latestRelease: { tag: string; publishedAt: string | null } | null;
  createdAt: string | null;
  pushedAt: string | null;
  /** Deltas over the last 30 days from daily snapshots (0 when unknown). */
  starsDelta30d: number;
  forksDelta30d: number;
  /** Traffic numbers are null when the repo has no traffic access. */
  traffic14d: TrafficTotals | null;
  trafficLifetime: TrafficTotals | null;
  /** First day with archived traffic, i.e. how far back "lifetime" goes. */
  trafficSince: Day | null;
  /** Daily views for the last 30 days, oldest first (always 30 numbers; empty if no access). */
  viewsSpark: number[];
  /** Daily star totals for the last 30 days, oldest first (may be shorter than 30). */
  starsSpark: number[];
  health: RepoHealth;
  lastSyncedAt: string | null;
}

export interface RepoHealth {
  /** 0-100 */
  score: number;
  issues: Array<'no-description' | 'no-license' | 'no-topics' | 'stale' | 'ci-failing' | 'no-readme'>;
}

export interface Release {
  id: number;
  tag: string;
  name: string | null;
  publishedAt: string | null;
  prerelease: boolean;
  downloads: number;
  htmlUrl: string;
  assets: Array<{ name: string; downloads: number; size: number }>;
}

/** GET /api/repos/:id */
export interface RepoDetail extends RepoSummary {
  homepage: string | null;
  defaultBranch: string | null;
  sizeKb: number;
  languages: Array<{ name: string; color: string | null; bytes: number }>;
  releases: Release[];
  /** True once the pre-tracking star history has been fully backfilled. */
  starHistoryComplete: boolean;
  /** Badge + share URLs (absolute). Only useful when shareEnabled. */
  share: { pageUrl: string; badges: Record<BadgeMetric, string> };
}

export interface TrafficPoint {
  day: Day;
  views: number;
  uniques: number;
  clones: number;
  cloneUniques: number;
}

/** GET /api/repos/:id/traffic?range=  and  GET /api/overview (aggregated across repos) */
export interface TrafficSeries {
  range: Range;
  /** Continuous daily series, oldest first, zero-filled. */
  points: TrafficPoint[];
  totals: TrafficTotals;
  /** Totals for the equally long period immediately before, for delta display. Null for `all`. */
  previous: TrafficTotals | null;
}

export interface MetricPoint {
  day: Day;
  stars: number | null;
  forks: number | null;
  watchers: number | null;
  openIssues: number | null;
  openPrs: number | null;
  releaseDownloads: number | null;
  /** True when the star count comes from backfilled history rather than a daily snapshot. */
  backfilled?: boolean;
}

/** GET /api/repos/:id/metrics?range= — sparse (only days with data), oldest first. */
export interface MetricSeries {
  range: Range;
  points: MetricPoint[];
}

export interface ReferrerRow {
  referrer: string;
  count: number;
  uniques: number;
}

export interface PathRow {
  path: string;
  title: string | null;
  count: number;
  uniques: number;
}

/** GET /api/repos/:id/referrers?range=14d|all  and  /paths */
export interface PopularList<T> {
  /** `14d` = GitHub's current rolling window, `all` = estimate summed from archived snapshots. */
  range: '14d' | 'all';
  since: Day | null;
  rows: T[];
}

export interface Commit {
  sha: string;
  repoId: number;
  repoFullName: string;
  message: string;
  authorLogin: string | null;
  authorName: string | null;
  authorAvatarUrl: string | null;
  committedAt: string;
  htmlUrl: string;
}

export type EventKind =
  | 'star-milestone'
  | 'traffic-spike'
  | 'new-release'
  | 'fork-milestone'
  | 'repo-discovered'
  | 'referrer-new';

/** GET /api/events?limit= */
export interface FeedEvent {
  id: number;
  kind: EventKind;
  repoId: number | null;
  repoFullName: string | null;
  title: string;
  detail: string | null;
  url: string | null;
  createdAt: string;
}

/** GET /api/overview?range= */
export interface Overview {
  range: Range;
  repoCount: number;
  trackedCount: number;
  followedCount: number;
  /** Aggregated over all own repos (followed repos excluded). */
  stars: number;
  forks: number;
  openIssues: number;
  openPrs: number;
  releaseDownloads: number;
  starsDelta: number;
  traffic: TrafficSeries;
  lifetime: TrafficTotals;
  /** Earliest archived traffic day across all repos. */
  trafficSince: Day | null;
  /** Total stars across own repos per day, oldest first, sparse. */
  starSeries: Array<{ day: Day; stars: number }>;
  topByViews: Array<{ id: number; fullName: string; views: number; uniques: number }>;
  topByClones: Array<{ id: number; fullName: string; clones: number; cloneUniques: number }>;
  topReferrers: ReferrerRow[];
  /** Commits per day across all own repos, last 371 days, oldest first. */
  commitCalendar: Array<{ day: Day; commits: number }>;
  languages: Array<{ name: string; color: string | null; bytes: number }>;
}

export interface ApiToken {
  id: number;
  name: string;
  /** First characters, for recognition, e.g. `re_ab12…`. */
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** POST /api/tokens → the only time the full token is returned. */
export interface ApiTokenCreated extends ApiToken {
  token: string;
}

export type BadgeMetric = 'views' | 'visitors' | 'clones' | 'stars' | 'downloads';

/** GET /api/public/:owner/:repo (no auth; 404 unless the owner enabled sharing) */
export interface PublicRepoStats {
  fullName: string;
  htmlUrl: string;
  description: string | null;
  language: string | null;
  languageColor: string | null;
  stars: number;
  forks: number;
  releaseDownloads: number;
  trafficSince: Day | null;
  lifetime: TrafficTotals;
  traffic: TrafficSeries;
  metrics: MetricSeries;
  referrers: ReferrerRow[];
  badges: Record<BadgeMetric, string>;
}

export interface RepoPatch {
  tracked?: boolean;
  pinned?: boolean;
  hidden?: boolean;
  tags?: string[];
  note?: string | null;
  shareEnabled?: boolean;
}

/** PATCH /api/repos/:id/github — writes through to GitHub (needs admin access). */
export interface RepoGithubPatch {
  description?: string;
  homepage?: string;
  topics?: string[];
}

/** Every non-2xx JSON response. `code` is stable, `error` is for display. */
export interface ApiError {
  error: string;
  code:
    | 'unauthorized'
    | 'forbidden'
    | 'demo-readonly'
    | 'not-found'
    | 'bad-request'
    | 'plan-limit'
    | 'rate-limited'
    | 'github-error'
    | 'internal';
}

/*
Endpoint list (all JSON unless noted; auth = session cookie or `Authorization: Bearer re_…`):

  GET    /api/info                         → AppInfo                 (no auth)
  GET    /api/me                           → Me                      (401 when signed out)
  PATCH  /api/me/settings   Partial<UserSettings> → Me
  DELETE /api/me                           → { ok: true }            (deletes account + data)
  GET    /api/sync                         → SyncStatus
  POST   /api/sync                         → SyncStatus              (starts a sync; 429 if too soon)
  GET    /api/overview?range=              → Overview
  GET    /api/repos                        → RepoSummary[]
  POST   /api/repos/follow  { fullName }   → RepoSummary             (accepts "owner/name" or a github.com URL)
  DELETE /api/repos/:id/follow             → { ok: true }
  PATCH  /api/repos/:id     RepoPatch      → RepoSummary
  PATCH  /api/repos/:id/github RepoGithubPatch → RepoSummary
  GET    /api/repos/:id                    → RepoDetail
  GET    /api/repos/:id/traffic?range=     → TrafficSeries
  GET    /api/repos/:id/metrics?range=     → MetricSeries
  GET    /api/repos/:id/referrers?range=14d|all → PopularList<ReferrerRow>
  GET    /api/repos/:id/paths?range=14d|all     → PopularList<PathRow>
  GET    /api/repos/:id/commits?limit=     → Commit[]
  GET    /api/commits?limit=               → Commit[]                (latest across all own repos)
  GET    /api/events?limit=                → FeedEvent[]
  GET    /api/repos/:id/export.csv?kind=traffic|metrics|referrers|paths → text/csv download
  GET    /api/export.json                  → full account export download
  GET    /api/tokens                       → ApiToken[]
  POST   /api/tokens        { name }       → ApiTokenCreated
  DELETE /api/tokens/:id                   → { ok: true }
  POST   /api/billing/checkout { interval: 'month' | 'year' } → { url }
  POST   /api/billing/portal               → { url }
  GET    /api/public/:owner/:repo          → PublicRepoStats         (no auth)
  GET    /badge/:owner/:repo/:metric.svg   → image/svg+xml           (no auth)

  GET    /auth/github                      → 302 to GitHub           (full-page navigation)
  POST   /auth/local        { password? }  → { ok: true }
  POST   /auth/demo                        → { ok: true }
  POST   /auth/logout                      → { ok: true }
*/
