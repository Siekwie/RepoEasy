import { config } from './config.ts';
import { decrypt, encrypt } from './crypto.ts';
import { nowIso, type DB, type UserRow } from './db.ts';
import { GitHubError, type GitHubUser } from './github.ts';

export interface TokenSet {
  accessToken: string;
  /** Only GitHub Apps with expiring user tokens send these. */
  refreshToken: string | null;
  expiresAt: string | null;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

async function tokenRequest(params: Record<string, string>, fetchFn: typeof fetch): Promise<TokenSet> {
  const res = await fetchFn(`${config.github.webUrl}/login/oauth/access_token`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'RepoEasy' },
    body: JSON.stringify({ client_id: config.github.clientId, client_secret: config.github.clientSecret, ...params }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json()) as TokenResponse;
  if (!body.access_token) {
    throw new GitHubError(body.error_description ?? body.error ?? 'GitHub did not return an access token', 401);
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    expiresAt: body.expires_in ? new Date(Date.now() + body.expires_in * 1000).toISOString() : null,
  };
}

export function exchangeCode(code: string, fetchFn: typeof fetch = fetch): Promise<TokenSet> {
  return tokenRequest({ code, redirect_uri: `${config.baseUrl}/auth/github/callback` }, fetchFn);
}

export function saveTokens(db: DB, userId: number, tokens: TokenSet): void {
  db.prepare(
    'UPDATE users SET token_enc = ?, refresh_token_enc = ?, token_expires_at = ?, token_invalid = 0 WHERE id = ?',
  ).run(encrypt(tokens.accessToken), tokens.refreshToken ? encrypt(tokens.refreshToken) : null, tokens.expiresAt, userId);
}

/** The user's GitHub token, refreshed first when it is an expiring GitHub App token. */
export async function accessToken(db: DB, user: UserRow, fetchFn: typeof fetch = fetch): Promise<string> {
  if (!user.token_enc) throw new GitHubError('No GitHub token on file. Sign in again.', 401);
  const expiring = user.token_expires_at && Date.parse(user.token_expires_at) - Date.now() < 5 * 60_000;
  if (expiring && user.refresh_token_enc) {
    const tokens = await tokenRequest({ grant_type: 'refresh_token', refresh_token: decrypt(user.refresh_token_enc) }, fetchFn);
    saveTokens(db, user.id, tokens);
    return tokens.accessToken;
  }
  return decrypt(user.token_enc);
}

/** Creates or updates the account for a GitHub identity and stores its token. */
export function upsertUser(db: DB, profile: GitHubUser, tokens: TokenSet): number {
  const now = nowIso();
  const row = db
    .prepare(
      `INSERT INTO users (github_id, login, name, avatar_url, email, created_at, last_login_at)
       VALUES (@id, @login, @name, @avatar_url, @email, @now, @now)
       ON CONFLICT(github_id) DO UPDATE SET login = excluded.login, name = excluded.name,
         avatar_url = excluded.avatar_url, email = COALESCE(excluded.email, email), last_login_at = excluded.last_login_at
       RETURNING id`,
    )
    .get({ id: profile.id, login: profile.login, name: profile.name ?? null, avatar_url: profile.avatar_url ?? null, email: profile.email ?? null, now }) as { id: number };
  saveTokens(db, row.id, tokens);
  return row.id;
}
