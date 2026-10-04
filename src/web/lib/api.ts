import type {
  ApiError,
  ApiToken,
  ApiTokenCreated,
  AppInfo,
  Commit,
  FeedEvent,
  MetricSeries,
  Me,
  Overview,
  PathRow,
  PopularList,
  PublicRepoStats,
  Range,
  ReferrerRow,
  RepoDetail,
  RepoGithubPatch,
  RepoPatch,
  RepoSummary,
  SyncStatus,
  TrafficSeries,
  UserSettings,
} from '../../shared/api.ts';

export class ApiException extends Error {
  status: number;
  code: ApiError['code'] | 'network';
  constructor(message: string, status: number, code: ApiError['code'] | 'network') {
    super(message);
    this.name = 'ApiException';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json', accept: 'application/json' } : { accept: 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiException('Could not reach the RepoEasy server. Check your connection and try again.', 0, 'network');
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let code: ApiError['code'] = 'internal';
    try {
      const j = (await res.json()) as Partial<ApiError>;
      if (j && typeof j.error === 'string') message = j.error;
      if (j && typeof j.code === 'string') code = j.code;
    } catch {
      /* body was not JSON */
    }
    throw new ApiException(message, res.status, code);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

const get = <T>(p: string) => request<T>('GET', p);
const send = <T>(m: string, p: string, b?: unknown) => request<T>(m, p, b);
const enc = encodeURIComponent;

export const api = {
  info: () => get<AppInfo>('/api/info'),
  me: () => get<Me>('/api/me'),
  patchSettings: (s: Partial<UserSettings>) => send<Me>('PATCH', '/api/me/settings', s),
  deleteMe: () => send<{ ok: true }>('DELETE', '/api/me'),
  syncStatus: () => get<SyncStatus>('/api/sync'),
  startSync: () => send<SyncStatus>('POST', '/api/sync'),
  overview: (range: Range) => get<Overview>(`/api/overview?range=${range}`),
  repos: () => get<RepoSummary[]>('/api/repos'),
  follow: (fullName: string) => send<RepoSummary>('POST', '/api/repos/follow', { fullName }),
  unfollow: (id: number) => send<{ ok: true }>('DELETE', `/api/repos/${id}/follow`),
  patchRepo: (id: number, p: RepoPatch) => send<RepoSummary>('PATCH', `/api/repos/${id}`, p),
  patchRepoGithub: (id: number, p: RepoGithubPatch) => send<RepoSummary>('PATCH', `/api/repos/${id}/github`, p),
  repo: (id: number) => get<RepoDetail>(`/api/repos/${id}`),
  repoTraffic: (id: number, range: Range) => get<TrafficSeries>(`/api/repos/${id}/traffic?range=${range}`),
  repoMetrics: (id: number, range: Range) => get<MetricSeries>(`/api/repos/${id}/metrics?range=${range}`),
  repoReferrers: (id: number, range: '14d' | 'all') => get<PopularList<ReferrerRow>>(`/api/repos/${id}/referrers?range=${range}`),
  repoPaths: (id: number, range: '14d' | 'all') => get<PopularList<PathRow>>(`/api/repos/${id}/paths?range=${range}`),
  repoCommits: (id: number, limit: number) => get<Commit[]>(`/api/repos/${id}/commits?limit=${limit}`),
  commits: (limit: number) => get<Commit[]>(`/api/commits?limit=${limit}`),
  events: (limit: number) => get<FeedEvent[]>(`/api/events?limit=${limit}`),
  tokens: () => get<ApiToken[]>('/api/tokens'),
  createToken: (name: string) => send<ApiTokenCreated>('POST', '/api/tokens', { name }),
  deleteToken: (id: number) => send<{ ok: true }>('DELETE', `/api/tokens/${id}`),
  checkout: (interval: 'month' | 'year') => send<{ url: string }>('POST', '/api/billing/checkout', { interval }),
  portal: () => send<{ url: string }>('POST', '/api/billing/portal'),
  publicRepo: (owner: string, repo: string) => get<PublicRepoStats>(`/api/public/${enc(owner)}/${enc(repo)}`),
  authLocal: (password?: string) => send<{ ok: true }>('POST', '/auth/local', password ? { password } : {}),
  authDemo: () => send<{ ok: true }>('POST', '/auth/demo'),
  logout: () => send<{ ok: true }>('POST', '/auth/logout'),
};

export const exportCsvUrl = (id: number, kind: 'traffic' | 'metrics' | 'referrers' | 'paths') =>
  `/api/repos/${id}/export.csv?kind=${kind}`;
