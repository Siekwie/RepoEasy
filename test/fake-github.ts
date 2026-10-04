// An in-memory stand-in for the parts of the GitHub API that RepoEasy calls.

export interface FakeRepo {
  id: number;
  owner: string;
  name: string;
  stars?: number;
  forks?: number;
  private?: boolean;
  archived?: boolean;
  permission?: 'ADMIN' | 'WRITE' | 'READ';
  pushedAt?: string;
  /** [day, count, uniques] as GitHub would currently report them. */
  views?: Array<[string, number, number]>;
  clones?: Array<[string, number, number]>;
  referrers?: Array<[string, number, number]>;
  paths?: Array<[string, number, number]>;
  releases?: Array<{ id: number; tag: string; downloads: number; publishedAt?: string }>;
  commits?: Array<{ sha: string; message: string; date: string }>;
  /** Star history pages, newest week first: [weekStartUnix, days[7]]. */
  starWeeks?: Array<[number, number[]]>;
}

export interface FakeState {
  login: string;
  repos: FakeRepo[];
  /** Public repos not owned by the viewer, reachable by name / node id. */
  others?: FakeRepo[];
  calls: string[];
  /** When set, every request fails with this status. */
  failWith?: { status: number; headers?: Record<string, string>; message: string };
}

const node = (r: FakeRepo, viewer: string) => ({
  id: `node-${r.id}`,
  databaseId: r.id,
  name: r.name,
  nameWithOwner: `${r.owner}/${r.name}`,
  owner: { login: r.owner },
  url: `https://github.com/${r.owner}/${r.name}`,
  isPrivate: Boolean(r.private),
  isFork: false,
  isArchived: Boolean(r.archived),
  isInOrganization: false,
  description: `${r.name} description`,
  homepageUrl: null,
  viewerPermission: r.permission ?? (r.owner === viewer ? 'ADMIN' : 'READ'),
  stargazerCount: r.stars ?? 0,
  forkCount: r.forks ?? 0,
  watchers: { totalCount: 1 },
  issues: { totalCount: 2 },
  pullRequests: { totalCount: 1 },
  releases: { totalCount: r.releases?.length ?? 0 },
  latestRelease: r.releases?.[0] ? { tagName: r.releases[0].tag, publishedAt: r.releases[0].publishedAt ?? null } : null,
  diskUsage: 100,
  createdAt: '2024-01-01T00:00:00Z',
  pushedAt: r.pushedAt ?? '2026-01-01T00:00:00Z',
  primaryLanguage: { name: 'TypeScript', color: '#3178c6' },
  languages: { edges: [{ size: 1000, node: { name: 'TypeScript', color: '#3178c6' } }] },
  repositoryTopics: { nodes: [] },
  licenseInfo: { spdxId: 'MIT' },
  defaultBranchRef: { name: 'main', target: { history: { totalCount: 10 }, statusCheckRollup: { state: 'SUCCESS' } } },
  readmeMd: { id: 'x' },
  readmeLower: null,
  readmeRst: null,
  readmePlain: null,
});

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'x-ratelimit-remaining': '4900', ...headers },
  });

export function fakeGitHub(state: FakeState): typeof fetch {
  const all = () => [...state.repos, ...(state.others ?? [])];
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    state.calls.push(`${method} ${url.pathname}`);
    if (url.hostname === 'api.stripe.com') return json({ id: 'sub_1', status: 'canceled' });
    if (state.failWith) return json({ message: state.failWith.message }, state.failWith.status, state.failWith.headers);

    if (url.pathname === '/login/oauth/access_token') {
      const { code } = JSON.parse(String(init?.body)) as { code?: string };
      return json(code === 'good-code' ? { access_token: 'oauth-token', token_type: 'bearer', scope: 'repo' } : { error: 'bad_verification_code' });
    }

    if (url.pathname === '/user') return json({ id: 1, login: state.login, name: 'Test User', avatar_url: null, email: null });

    if (url.pathname === '/graphql') {
      const { query, variables } = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
      if (query.includes('viewer {')) {
        return json({ data: { viewer: { repositories: { nodes: state.repos.map((r) => ({ id: `node-${r.id}` })), pageInfo: { hasNextPage: false, endCursor: null } } } } });
      }
      if (query.includes('nodes(ids')) {
        const ids = variables.ids as string[];
        return json({ data: { nodes: ids.map((id) => { const r = all().find((x) => `node-${x.id}` === id); return r ? node(r, state.login) : null; }) } });
      }
      const found = all().find((r) => r.owner === variables.owner && r.name === variables.name);
      if (!found) return json({ data: null, errors: [{ type: 'NOT_FOUND', message: 'Could not resolve to a Repository' }] });
      return json({ data: { repository: node(found, state.login) } });
    }

    const match = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(url.pathname);
    const repo = match && all().find((r) => r.owner === match[1] && r.name === match[2]);
    if (!match || !repo) return json({ message: 'Not Found' }, 404);
    const rest = match[3] ?? '';
    const series = (rows: Array<[string, number, number]> = []) => rows.map(([day, count, uniques]) => ({ timestamp: `${day}T00:00:00Z`, count, uniques }));

    if (rest.startsWith('/traffic') && (repo.permission ?? (repo.owner === state.login ? 'ADMIN' : 'READ')) === 'READ') {
      return json({ message: 'Must have push access to repository' }, 403);
    }
    switch (rest) {
      case '/traffic/views':
        return json({ count: 0, uniques: 0, views: series(repo.views) });
      case '/traffic/clones':
        return json({ count: 0, uniques: 0, clones: series(repo.clones) });
      case '/traffic/popular/referrers':
        return json((repo.referrers ?? []).map(([referrer, count, uniques]) => ({ referrer, count, uniques })));
      case '/traffic/popular/paths':
        return json((repo.paths ?? []).map(([path, count, uniques]) => ({ path, title: path, count, uniques })));
      case '/releases':
        return json(
          (repo.releases ?? []).map((r) => ({
            id: r.id, tag_name: r.tag, name: r.tag, draft: false, prerelease: false, published_at: r.publishedAt ?? '2026-01-01T00:00:00Z',
            html_url: `https://github.com/${repo.owner}/${repo.name}/releases/tag/${r.tag}`,
            assets: [{ name: 'app.zip', download_count: r.downloads, size: 10 }],
          })),
        );
      case '/commits': {
        const since = url.searchParams.get('since');
        return json(
          (repo.commits ?? [])
            .filter((c) => !since || Date.parse(c.date) >= Date.parse(since))
            .sort((a, b) => Date.parse(b.date) - Date.parse(a.date)) // GitHub lists newest first
            .map((c) => ({
              sha: c.sha, html_url: `https://github.com/${repo.owner}/${repo.name}/commit/${c.sha}`,
              commit: { message: c.message, author: { name: 'Test User', date: c.date }, committer: { date: c.date } },
              author: { login: state.login, avatar_url: 'https://avatars.example/u/1' },
            })),
        );
      }
      case '/stargazers/history':
        return json(url.searchParams.get('page') === '1' ? (repo.starWeeks ?? []).map(([week, days]) => ({ week, total: days.reduce((a, b) => a + b, 0), days })) : []);
      case '/topics':
      case '':
        return json({ ok: true });
      default:
        return json({ message: 'Not Found' }, 404);
    }
  }) as typeof fetch;
}
