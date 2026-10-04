import { config } from './config.ts';
import { nowIso, utcIso } from './db.ts';
import { GitHub } from './github.ts';
import type { RepoRecord } from './sync.ts';

/**
 * repos.github_id is unique across hosts, so a Codeberg repository is stored under its Codeberg id
 * plus this offset: far above any GitHub id, and still an exact integer in JavaScript.
 */
export const CODEBERG_ID_OFFSET = 1e15;

/**
 * Codeberg runs Forgejo, whose REST API has the same shape as GitHub's for releases and commits,
 * so those are collected by the same code as for GitHub. It reports no views, clones or referrers
 * and no star dates: Codeberg repositories can be followed, and that is all. Requests are
 * anonymous unless CODEBERG_TOKEN is set.
 */
export class Codeberg extends GitHub {
  protected override readonly service: string = 'Codeberg';

  constructor(fetchFn: typeof fetch = fetch, token = config.codeberg.token ?? '', apiUrl = config.codeberg.apiUrl) {
    super(token, fetchFn, apiUrl);
  }

  protected override headers(): Record<string, string> {
    return { Accept: 'application/json', ...(this.token ? { Authorization: `token ${this.token}` } : {}) };
  }
}

interface ForgejoRepo {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  html_url: string;
  private: boolean;
  fork: boolean;
  archived: boolean;
  empty: boolean;
  description: string | null;
  website: string | null;
  language: string | null;
  topics: string[] | null;
  default_branch: string | null;
  size: number;
  stars_count: number;
  forks_count: number;
  watchers_count: number;
  open_issues_count: number;
  open_pr_counter: number;
  release_counter: number;
  created_at: string;
  updated_at: string;
}

const CI_STATES: Record<string, string> = { success: 'SUCCESS', failure: 'FAILURE', error: 'ERROR', pending: 'PENDING' };

/** Forgejo names languages without their colour; these are the colours GitHub shows for the common ones. */
const LANGUAGE_COLORS: Record<string, string> = {
  C: '#555555',
  'C#': '#178600',
  'C++': '#f34b7d',
  CSS: '#663399',
  Dart: '#00B4AB',
  Dockerfile: '#384d54',
  Elixir: '#6e4a7e',
  Go: '#00ADD8',
  Haskell: '#5e5086',
  HTML: '#e34c26',
  Java: '#b07219',
  JavaScript: '#f1e05a',
  Kotlin: '#A97BFF',
  Lua: '#000080',
  Makefile: '#427819',
  Nix: '#7e7eff',
  PHP: '#4F5D95',
  Python: '#3572A5',
  Ruby: '#701516',
  Rust: '#dea584',
  Shell: '#89e051',
  Svelte: '#ff3e00',
  Swift: '#F05138',
  TypeScript: '#3178c6',
  Vue: '#41b883',
  Zig: '#ec915c',
};
const colorOf = (language: string | null) => (language ? (LANGUAGE_COLORS[language] ?? null) : null);

/** A Codeberg repository as a row for the repos table, or null when there is no such public repository. */
export async function fetchCodebergRepo(cb: Codeberg, owner: string, name: string): Promise<RepoRecord | null> {
  const found = await cb.rest<ForgejoRepo>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, { allow: [404] });
  const r = found.data;
  if (found.status !== 200 || !r?.id) return null;

  // a renamed repository answers under its old name too: the rest is asked for under the current one
  const base = `/repos/${encodeURIComponent(r.owner.login)}/${encodeURIComponent(r.name)}`;
  const allow = [404, 409];
  const languages = await cb.rest<Record<string, number>>(`${base}/languages`, { allow });
  const status =
    r.empty || !r.default_branch
      ? null
      : await cb.rest<{ state?: string }>(`${base}/commits/${encodeURIComponent(r.default_branch)}/status`, { allow });
  const latest =
    r.release_counter > 0 ? await cb.rest<{ tag_name?: string; published_at?: string | null }>(`${base}/releases/latest`, { allow }) : null;

  return {
    host: 'codeberg',
    github_id: CODEBERG_ID_OFFSET + r.id,
    node_id: null,
    owner: r.owner.login,
    name: r.name,
    full_name: r.full_name,
    html_url: r.html_url,
    private: r.private ? 1 : 0,
    fork: r.fork ? 1 : 0,
    archived: r.archived ? 1 : 0,
    in_org: 0,
    description: r.description || null,
    homepage: r.website || null,
    language: r.language || null,
    language_color: colorOf(r.language),
    languages_json: JSON.stringify(
      Object.entries(languages.status === 200 && languages.data ? languages.data : {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([language, bytes]) => ({ name: language, color: colorOf(language), bytes })),
    ),
    topics_json: JSON.stringify(r.topics ?? []),
    // Forgejo reports neither the license nor whether there is a README; the health check leaves both out
    license: null,
    default_branch: r.default_branch || null,
    has_readme: 1,
    size_kb: r.size ?? 0,
    stars: r.stars_count ?? 0,
    forks: r.forks_count ?? 0,
    watchers: r.watchers_count ?? 0,
    open_issues: r.open_issues_count ?? 0,
    open_prs: r.open_pr_counter ?? 0,
    release_count: r.release_counter ?? 0,
    commit_count: null,
    ci_state: (status?.status === 200 && CI_STATES[status.data?.state ?? '']) || null,
    latest_release_tag: (latest?.status === 200 && latest.data?.tag_name) || null,
    latest_release_at: (latest?.status === 200 && utcIso(latest.data?.published_at)) || null,
    created_at_gh: utcIso(r.created_at),
    // Forgejo has no push date; the last update of the repository is the closest thing it reports
    pushed_at: utcIso(r.updated_at),
    meta_synced_at: nowIso(),
  };
}
