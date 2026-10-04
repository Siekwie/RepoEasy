import { config } from './config.ts';

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Primary or secondary rate limit: stop and try again later. */
    readonly rateLimited = false,
    /** The service that failed, for messages: Codeberg is reached through the same client. */
    readonly service = 'GitHub',
  ) {
    super(message);
    this.name = 'GitHubError';
  }
  /** The token no longer works at all. */
  get unauthorized() {
    return this.status === 401;
  }
}

type FetchFn = typeof fetch;

interface RestOptions {
  method?: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  /** Statuses to hand back instead of throwing (e.g. 403/404 for optional data). */
  allow?: number[];
}

export interface RestResponse<T> {
  status: number;
  data: T;
  /** URL of the next page from the Link header, if any. */
  next: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Minimal GitHub REST + GraphQL client for one access token. */
export class GitHub {
  rateRemaining: number | null = null;
  requests = 0;
  protected readonly service: string = 'GitHub';

  constructor(
    protected readonly token: string,
    private readonly fetchFn: FetchFn = fetch,
    private readonly apiUrl = config.github.apiUrl,
  ) {}

  protected headers(): Record<string, string> {
    return {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${this.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  private async request(url: string, init: RequestInit, attempts = 3): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) await sleep(400 * 2 ** attempt);
      let res: Response;
      try {
        this.requests++;
        res = await this.fetchFn(url, {
          ...init,
          headers: {
            ...this.headers(),
            'User-Agent': 'RepoEasy',
            ...(init.body ? { 'Content-Type': 'application/json' } : {}),
            ...init.headers,
          },
          signal: AbortSignal.timeout(30_000),
        });
      } catch (err) {
        lastError = err;
        continue;
      }
      const remaining = res.headers.get('x-ratelimit-remaining');
      if (remaining !== null && res.headers.get('x-ratelimit-resource') !== 'search') {
        this.rateRemaining = Number(remaining);
      }
      if (res.status >= 500) {
        lastError = new GitHubError(`${this.service} responded ${res.status}`, res.status, false, this.service);
        continue;
      }
      return res;
    }
    if (lastError instanceof GitHubError) throw lastError;
    throw new GitHubError(`${this.service} request failed: ${(lastError as Error)?.message ?? 'network error'}`, 0, false, this.service);
  }

  private static rateLimited(res: Response): boolean {
    return (
      res.status === 429 ||
      (res.status === 403 && (res.headers.get('x-ratelimit-remaining') === '0' || res.headers.has('retry-after')))
    );
  }

  private async fail(res: Response): Promise<never> {
    let message = `${this.service} responded ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // non-JSON error body
    }
    throw new GitHubError(message, res.status, GitHub.rateLimited(res), this.service);
  }

  async rest<T>(path: string, options: RestOptions = {}): Promise<RestResponse<T>> {
    const url = new URL(path.startsWith('http') ? path : `${this.apiUrl}${path}`);
    for (const [k, v] of Object.entries(options.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const res = await this.request(url.toString(), {
      method: options.method ?? 'GET',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    // a rate limit is never an acceptable answer, even where a plain 403 is
    if (!res.ok && (GitHub.rateLimited(res) || !options.allow?.includes(res.status))) await this.fail(res);
    const next = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') ?? '')?.[1] ?? null;
    const text = await res.text();
    let data = null as T;
    if (text) {
      try {
        data = JSON.parse(text) as T;
      } catch {
        // leave data null for non-JSON bodies
      }
    }
    return { status: res.status, data, next };
  }

  /**
   * Runs a GraphQL query. Partial results are returned as-is: GitHub reports
   * per-field problems (e.g. a field the token may not read) alongside usable data.
   */
  async graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    // No blind retries: a 502 here means the query ran into GitHub's 10s limit,
    // and callers react by asking for less (see fetchReposByNodeId).
    const res = await this.request(`${this.apiUrl}/graphql`, { method: 'POST', body: JSON.stringify({ query, variables }) }, 1);
    if (!res.ok) await this.fail(res);
    const body = (await res.json()) as { data?: T; errors?: Array<{ type?: string; message: string }> };
    if (!body.data) {
      const first = body.errors?.[0];
      throw new GitHubError(first?.message ?? 'GraphQL query failed', 200, first?.type === 'RATE_LIMITED');
    }
    return body.data;
  }
}

const REPO_FIELDS = `
fragment RepoFields on Repository {
  id
  databaseId
  name
  nameWithOwner
  owner { login }
  url
  isPrivate
  isFork
  isArchived
  isInOrganization
  description
  homepageUrl
  viewerPermission
  stargazerCount
  forkCount
  watchers { totalCount }
  issues(states: OPEN) { totalCount }
  pullRequests(states: OPEN) { totalCount }
  releases { totalCount }
  latestRelease { tagName publishedAt }
  diskUsage
  createdAt
  pushedAt
  primaryLanguage { name color }
  languages(first: 8, orderBy: {field: SIZE, direction: DESC}) { edges { size node { name color } } }
  repositoryTopics(first: 20) { nodes { topic { name } } }
  licenseInfo { spdxId }
  defaultBranchRef { name target { ... on Commit { history { totalCount } statusCheckRollup { state } } } }
  readmeMd: object(expression: "HEAD:README.md") { id }
  readmeLower: object(expression: "HEAD:readme.md") { id }
  readmeRst: object(expression: "HEAD:README.rst") { id }
  readmePlain: object(expression: "HEAD:README") { id }
}`;

export interface GqlRepo {
  id: string;
  databaseId: number;
  name: string;
  nameWithOwner: string;
  owner: { login: string };
  url: string;
  isPrivate: boolean;
  isFork: boolean;
  isArchived: boolean;
  isInOrganization: boolean;
  description: string | null;
  homepageUrl: string | null;
  viewerPermission: 'ADMIN' | 'MAINTAIN' | 'WRITE' | 'TRIAGE' | 'READ' | null;
  stargazerCount: number;
  forkCount: number;
  watchers: { totalCount: number } | null;
  issues: { totalCount: number } | null;
  pullRequests: { totalCount: number } | null;
  releases: { totalCount: number } | null;
  latestRelease: { tagName: string; publishedAt: string | null } | null;
  diskUsage: number | null;
  createdAt: string | null;
  pushedAt: string | null;
  primaryLanguage: { name: string; color: string | null } | null;
  languages: { edges: Array<{ size: number; node: { name: string; color: string | null } }> } | null;
  repositoryTopics: { nodes: Array<{ topic: { name: string } }> } | null;
  licenseInfo: { spdxId: string | null } | null;
  defaultBranchRef: {
    name: string;
    target: { history?: { totalCount: number }; statusCheckRollup?: { state: string } | null } | null;
  } | null;
  readmeMd: { id: string } | null;
  readmeLower: { id: string } | null;
  readmeRst: { id: string } | null;
  readmePlain: { id: string } | null;
}

export interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
  email: string | null;
}

export async function fetchViewer(gh: GitHub): Promise<GitHubUser> {
  return (await gh.rest<GitHubUser>('/user')).data;
}

/**
 * Node ids of every repo the token's user owns, collaborates on, or can see
 * through an org, most recently pushed first. Ids only: this stays fast and
 * complete even for accounts with thousands of repos.
 */
export async function fetchViewerRepoIds(gh: GitHub): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null = null;
  do {
    const data: {
      viewer: { repositories: { nodes: Array<{ id: string } | null>; pageInfo: { hasNextPage: boolean; endCursor: string | null } } };
    } = await gh.graphql(
      `query($cursor: String) {
        viewer {
          repositories(first: 100, after: $cursor,
            affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER],
            ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER],
            orderBy: {field: PUSHED_AT, direction: DESC}) {
            nodes { id }
            pageInfo { hasNextPage endCursor }
          }
        }
      }`,
      { cursor },
    );
    const page = data.viewer.repositories;
    for (const node of page.nodes) if (node) ids.push(node.id);
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);
  return ids;
}

/** Repo details cost GitHub roughly 0.25s each and a query may run 10s, so batches stay small. */
const DETAIL_BATCH = 15;
const DETAIL_CONCURRENCY = 3;

async function fetchRepoBatch(gh: GitHub, ids: string[]): Promise<GqlRepo[]> {
  try {
    const data = await gh.graphql<{ nodes: Array<GqlRepo | null> }>(
      `query($ids: [ID!]!) { nodes(ids: $ids) { ...RepoFields } }${REPO_FIELDS}`,
      { ids },
    );
    return data.nodes.filter((n): n is GqlRepo => Boolean(n?.databaseId));
  } catch (err) {
    const timedOut = err instanceof GitHubError && (err.status >= 500 || err.status === 0);
    if (!timedOut) throw err;
    if (ids.length === 1) {
      console.warn(`[github] details for ${ids[0]} timed out; skipped this round`);
      return [];
    }
    const half = Math.ceil(ids.length / 2);
    return [...(await fetchRepoBatch(gh, ids.slice(0, half))), ...(await fetchRepoBatch(gh, ids.slice(half)))];
  }
}

/** Full details for repos by GraphQL node id. Missing or inaccessible ones are dropped; order is kept. */
export async function fetchReposByNodeId(gh: GitHub, nodeIds: string[]): Promise<GqlRepo[]> {
  const batches: string[][] = [];
  for (let i = 0; i < nodeIds.length; i += DETAIL_BATCH) batches.push(nodeIds.slice(i, i + DETAIL_BATCH));
  const results: GqlRepo[][] = new Array(batches.length);
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const index = next++;
      results[index] = await fetchRepoBatch(gh, batches[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(DETAIL_CONCURRENCY, batches.length) }, worker));
  return results.flat();
}

export async function fetchRepoByName(gh: GitHub, owner: string, name: string): Promise<GqlRepo | null> {
  try {
    const data = await gh.graphql<{ repository: GqlRepo | null }>(
      `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ...RepoFields } }${REPO_FIELDS}`,
      { owner, name },
    );
    return data.repository;
  } catch (err) {
    // an unknown repo comes back as a data-less NOT_FOUND error
    if (err instanceof GitHubError && err.status === 200 && !err.rateLimited) return null;
    throw err;
  }
}
