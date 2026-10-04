import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ApiError } from '../shared/api.ts';
import { config, effectivePlan, planLimits } from './config.ts';
import { randomToken, sha256 } from './crypto.ts';
import { nowIso, type DB, type UserRow } from './db.ts';

export type Env = { Variables: { user: UserRow; viaToken: boolean } };
export type Ctx = Context<Env>;

const STATUS: Record<ApiError['code'], ContentfulStatusCode> = {
  unauthorized: 401,
  forbidden: 403,
  'demo-readonly': 403,
  'not-found': 404,
  'bad-request': 400,
  'plan-limit': 402,
  'rate-limited': 429,
  'github-error': 502,
  internal: 500,
};

/** Thrown anywhere in a handler; rendered as an ApiError response. */
export class ApiFail extends Error {
  readonly status: ContentfulStatusCode;
  constructor(
    readonly code: ApiError['code'],
    message: string,
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

export const fail = (code: ApiError['code'], message: string): never => {
  throw new ApiFail(code, message);
};

const SESSION_COOKIE = 're_session';
const SESSION_DAYS = 60;
const secure = config.baseUrl.startsWith('https://');

export function createSession(c: Ctx, db: DB, userId: number, days = SESSION_DAYS): void {
  const token = randomToken();
  const expires = new Date(Date.now() + days * 86_400_000);
  db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    sha256(token),
    userId,
    nowIso(),
    expires.toISOString(),
  );
  setCookie(c, SESSION_COOKIE, token, { httpOnly: true, sameSite: 'Lax', secure, path: '/', expires });
}

export function destroySession(c: Ctx, db: DB): void {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) db.prepare('DELETE FROM sessions WHERE id = ?').run(sha256(token));
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}

/** Resolves the caller from a session cookie or an `Authorization: Bearer re_…` API token. */
export function currentUser(c: Ctx, db: DB): { user: UserRow; viaToken: boolean } | null {
  const bearer = /^Bearer\s+(re_[\w-]+)$/.exec(c.req.header('authorization') ?? '')?.[1];
  if (bearer) {
    const row = db
      .prepare('SELECT u.*, t.id AS token_id FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?')
      .get(sha256(bearer)) as (UserRow & { token_id: number }) | undefined;
    if (!row) return null;
    db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(nowIso(), row.token_id);
    return { user: row, viaToken: true };
  }
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const user = db
    .prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?')
    .get(sha256(token), nowIso()) as UserRow | undefined;
  return user ? { user, viaToken: false } : null;
}

export const requireUser =
  (db: DB): MiddlewareHandler<Env> =>
  async (c, next) => {
    const auth = currentUser(c, db);
    if (!auth) return fail('unauthorized', 'Sign in to continue.');
    const readOnly = ['GET', 'HEAD'].includes(c.req.method);
    if (auth.user.is_demo && !readOnly) {
      return fail('demo-readonly', 'The demo account is read-only. Sign in with GitHub to track your own repositories.');
    }
    if (auth.viaToken) {
      // API tokens read data; changing things takes a signed-in browser session
      if (!readOnly) return fail('forbidden', 'API tokens are read-only.');
      if (!planLimits(effectivePlan(auth.user)).apiTokens) return fail('plan-limit', 'API access is part of the Pro plan.');
    }
    c.set('user', auth.user);
    c.set('viaToken', auth.viaToken);
    await next();
  };

/**
 * Rejects cross-site state-changing requests. Session cookies are SameSite=Lax
 * already; this covers browsers or setups where that is not enough.
 */
export const sameOrigin: MiddlewareHandler<Env> = async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && !c.req.header('authorization')) {
    const origin = c.req.header('origin');
    if (origin) {
      let host: string | null = null;
      try {
        host = new URL(origin).host;
      } catch {
        // malformed Origin: treated as cross-site below
      }
      if (host !== c.req.header('host') && !config.allowedOrigins.includes(origin)) {
        return fail('forbidden', 'Cross-site request blocked.');
      }
    } else if (c.req.header('sec-fetch-site') === 'cross-site') {
      return fail('forbidden', 'Cross-site request blocked.');
    }
  }
  await next();
};

/**
 * Refuses API and auth requests addressed to a hostname this server is not
 * configured for. A DNS-rebinding page reaches a local server under its own
 * hostname, so it fails here before it can sign in or read anything.
 */
export const trustedHost: MiddlewareHandler<Env> = async (c, next) => {
  if (!config.allowedHosts.includes(new URL(c.req.url).hostname)) {
    return fail('forbidden', 'This server is not configured for that hostname. Set BASE_URL to the address you use to reach it.');
  }
  await next();
};

/** Network address of the caller, for rate limiting. */
export function clientAddress(c: Ctx): string {
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming;
  return incoming?.socket?.remoteAddress ?? 'unknown';
}

export async function body<T extends object>(c: Ctx): Promise<Partial<T>> {
  try {
    const value: unknown = await c.req.json();
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Partial<T>;
  } catch {
    // fall through
  }
  return fail('bad-request', 'Expected a JSON object body.');
}

export function csv(header: string[], rows: Array<Array<string | number | null>>): string {
  const cell = (v: string | number | null) => {
    if (v === null) return '';
    let s = String(v);
    // neutralise spreadsheet formulas in exported text
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
