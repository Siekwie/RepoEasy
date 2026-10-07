import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type DB = Database.Database;

// Append-only: each entry runs once, tracked by PRAGMA user_version.
const migrations: string[] = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    github_id INTEGER UNIQUE,
    login TEXT NOT NULL,
    name TEXT,
    avatar_url TEXT,
    email TEXT,
    token_enc TEXT,
    refresh_token_enc TEXT,
    token_expires_at TEXT,
    token_invalid INTEGER NOT NULL DEFAULT 0,
    is_demo INTEGER NOT NULL DEFAULT 0,
    plan TEXT NOT NULL DEFAULT 'free',
    plan_expires_at TEXT,
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    settings_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    last_login_at TEXT,
    last_sync_at TEXT,
    last_sync_started_at TEXT,
    last_sync_error TEXT,
    rate_remaining INTEGER
  );

  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE api_tokens (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    prefix TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_used_at TEXT
  );

  CREATE TABLE repos (
    id INTEGER PRIMARY KEY,
    github_id INTEGER NOT NULL UNIQUE,
    node_id TEXT,
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    full_name TEXT NOT NULL COLLATE NOCASE,
    html_url TEXT NOT NULL,
    private INTEGER NOT NULL DEFAULT 0,
    fork INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    in_org INTEGER NOT NULL DEFAULT 0,
    description TEXT,
    homepage TEXT,
    language TEXT,
    language_color TEXT,
    languages_json TEXT NOT NULL DEFAULT '[]',
    topics_json TEXT NOT NULL DEFAULT '[]',
    license TEXT,
    default_branch TEXT,
    has_readme INTEGER NOT NULL DEFAULT 1,
    size_kb INTEGER NOT NULL DEFAULT 0,
    stars INTEGER NOT NULL DEFAULT 0,
    forks INTEGER NOT NULL DEFAULT 0,
    watchers INTEGER NOT NULL DEFAULT 0,
    open_issues INTEGER NOT NULL DEFAULT 0,
    open_prs INTEGER NOT NULL DEFAULT 0,
    release_count INTEGER NOT NULL DEFAULT 0,
    release_downloads INTEGER NOT NULL DEFAULT 0,
    commit_count INTEGER,
    ci_state TEXT,
    latest_release_tag TEXT,
    latest_release_at TEXT,
    created_at_gh TEXT,
    pushed_at TEXT,
    share_enabled INTEGER NOT NULL DEFAULT 0,
    meta_synced_at TEXT,
    traffic_synced_at TEXT,
    detail_synced_at TEXT,
    commits_pushed_at TEXT,
    star_backfill_page INTEGER NOT NULL DEFAULT 1,
    star_backfill_done INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX repos_full_name ON repos(full_name);

  CREATE TABLE user_repos (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    relation TEXT NOT NULL,
    can_push INTEGER NOT NULL DEFAULT 0,
    can_admin INTEGER NOT NULL DEFAULT 0,
    tracked INTEGER NOT NULL DEFAULT 0,
    pinned INTEGER NOT NULL DEFAULT 0,
    hidden INTEGER NOT NULL DEFAULT 0,
    -- set when a repo no longer shows up in the account; its history is kept
    gone INTEGER NOT NULL DEFAULT 0,
    tags_json TEXT NOT NULL DEFAULT '[]',
    note TEXT,
    added_at TEXT NOT NULL,
    PRIMARY KEY (user_id, repo_id)
  ) WITHOUT ROWID;
  CREATE INDEX user_repos_repo ON user_repos(repo_id);

  -- One row per repo per UTC day, merged from GitHub's rolling 14-day window.
  CREATE TABLE traffic_daily (
    repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    views INTEGER NOT NULL DEFAULT 0,
    uniques INTEGER NOT NULL DEFAULT 0,
    clones INTEGER NOT NULL DEFAULT 0,
    clone_uniques INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (repo_id, day)
  ) WITHOUT ROWID;

  -- Referrers and paths are only reported as 14-day rolling totals, so these
  -- hold one snapshot of that window per day.
  CREATE TABLE referrers_snap (
    repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    referrer TEXT NOT NULL,
    count INTEGER NOT NULL,
    uniques INTEGER NOT NULL,
    PRIMARY KEY (repo_id, day, referrer)
  ) WITHOUT ROWID;

  CREATE TABLE paths_snap (
    repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    path TEXT NOT NULL,
    title TEXT,
    count INTEGER NOT NULL,
    uniques INTEGER NOT NULL,
    PRIMARY KEY (repo_id, day, path)
  ) WITHOUT ROWID;

  CREATE TABLE metrics_daily (
    repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    stars INTEGER,
    forks INTEGER,
    watchers INTEGER,
    open_issues INTEGER,
    open_prs INTEGER,
    release_downloads INTEGER,
    PRIMARY KEY (repo_id, day)
  ) WITHOUT ROWID;

  -- New stars per day from GitHub's star-history endpoint (covers the time before tracking began).
  CREATE TABLE star_history (
    repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    new_stars INTEGER NOT NULL,
    PRIMARY KEY (repo_id, day)
  ) WITHOUT ROWID;

  CREATE TABLE releases (
    repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    release_id INTEGER NOT NULL,
    tag TEXT NOT NULL,
    name TEXT,
    published_at TEXT,
    prerelease INTEGER NOT NULL DEFAULT 0,
    downloads INTEGER NOT NULL DEFAULT 0,
    html_url TEXT NOT NULL,
    assets_json TEXT NOT NULL DEFAULT '[]',
    PRIMARY KEY (repo_id, release_id)
  ) WITHOUT ROWID;

  CREATE TABLE commits (
    repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    sha TEXT NOT NULL,
    message TEXT NOT NULL,
    author_login TEXT,
    author_name TEXT,
    author_avatar_url TEXT,
    committed_at TEXT NOT NULL,
    html_url TEXT NOT NULL,
    PRIMARY KEY (repo_id, sha)
  ) WITHOUT ROWID;
  CREATE INDEX commits_time ON commits(committed_at);

  CREATE TABLE events (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    repo_id INTEGER REFERENCES repos(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    detail TEXT,
    url TEXT,
    dedupe_key TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (user_id, dedupe_key)
  );
  CREATE INDEX events_user_time ON events(user_id, created_at);
  `,
  `
  CREATE INDEX repos_node_id ON repos(node_id);
  CREATE INDEX users_stripe_customer ON users(stripe_customer_id);
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE INDEX events_repo ON events(repo_id);
  CREATE INDEX api_tokens_user ON api_tokens(user_id);
  `,
  `
  -- Counters for the admin page: how often the landing page was opened, sign-in was started, the
  -- demo was opened and an account was created, per UTC day and source. Nothing about the visitor.
  CREATE TABLE visits (
    day TEXT NOT NULL,
    kind TEXT NOT NULL,
    source TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, kind, source)
  ) WITHOUT ROWID;

  ALTER TABLE users ADD COLUMN signup_source TEXT;
  ALTER TABLE users ADD COLUMN last_seen_at TEXT;
  `,
  `
  -- Where a repository is hosted: 'github' or 'codeberg'. github_id is unique across hosts, so a
  -- Codeberg repository is stored under its Codeberg id plus an offset (see codeberg.ts).
  ALTER TABLE repos ADD COLUMN host TEXT NOT NULL DEFAULT 'github';
  `,
];

export function openDb(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  const current = db.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < migrations.length; v++) {
    db.transaction(() => {
      db.exec(migrations[v]!);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
  return db;
}

/**
 * A connection that can only read, for the admin interface: it shares the file with the running
 * server, which creates and migrates it, and can never change the archive itself.
 */
export function openDbReadOnly(path: string): DB {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  db.pragma('busy_timeout = 5000');
  return db;
}

export const nowIso = () => new Date().toISOString();

/** UTC calendar day `YYYY-MM-DD`. */
export const dayOf = (date: Date | string | number = new Date()) => new Date(date).toISOString().slice(0, 10);

/** Forgejo reports local times with an offset; everything stored is UTC, the way GitHub reports it. */
export function utcIso(iso: string | null | undefined): string | null {
  if (!iso || iso.endsWith('Z')) return iso || null;
  const time = Date.parse(iso);
  return Number.isNaN(time) ? null : new Date(time).toISOString().replace('.000Z', 'Z');
}

export function addDays(day: string, delta: number): string {
  return dayOf(Date.parse(`${day}T00:00:00Z`) + delta * 86_400_000);
}

export interface UserRow {
  id: number;
  github_id: number | null;
  login: string;
  name: string | null;
  avatar_url: string | null;
  email: string | null;
  token_enc: string | null;
  refresh_token_enc: string | null;
  token_expires_at: string | null;
  token_invalid: number;
  is_demo: number;
  plan: string;
  plan_expires_at: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  settings_json: string;
  created_at: string;
  last_login_at: string | null;
  last_sync_at: string | null;
  last_sync_started_at: string | null;
  last_sync_error: string | null;
  rate_remaining: number | null;
  signup_source: string | null;
  last_seen_at: string | null;
}

export interface RepoRow {
  id: number;
  github_id: number;
  node_id: string | null;
  owner: string;
  name: string;
  full_name: string;
  html_url: string;
  private: number;
  fork: number;
  archived: number;
  in_org: number;
  description: string | null;
  homepage: string | null;
  language: string | null;
  language_color: string | null;
  languages_json: string;
  topics_json: string;
  license: string | null;
  default_branch: string | null;
  has_readme: number;
  size_kb: number;
  stars: number;
  forks: number;
  watchers: number;
  open_issues: number;
  open_prs: number;
  release_count: number;
  release_downloads: number;
  commit_count: number | null;
  ci_state: string | null;
  latest_release_tag: string | null;
  latest_release_at: string | null;
  created_at_gh: string | null;
  pushed_at: string | null;
  share_enabled: number;
  meta_synced_at: string | null;
  traffic_synced_at: string | null;
  detail_synced_at: string | null;
  commits_pushed_at: string | null;
  star_backfill_page: number;
  star_backfill_done: number;
  host: string;
}

export interface UserRepoRow {
  user_id: number;
  repo_id: number;
  relation: string;
  can_push: number;
  can_admin: number;
  tracked: number;
  pinned: number;
  hidden: number;
  gone: number;
  tags_json: string;
  note: string | null;
  added_at: string;
}
