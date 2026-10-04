import { createApp } from '../src/server/app.ts';
import { randomToken, sha256 } from '../src/server/crypto.ts';
import { nowIso, openDb, type DB } from '../src/server/db.ts';
import { GitHub } from '../src/server/github.ts';
import { syncUser } from '../src/server/sync.ts';
import { upsertUser } from '../src/server/tokens.ts';
import { fakeGitHub, type FakeRepo, type FakeState } from './fake-github.ts';

const API = 'https://api.github.test';

/** A database with one signed-in account wired to a fake GitHub. */
export function setup(repos: FakeRepo[], others: FakeRepo[] = []) {
  const state: FakeState = { login: 'alice', repos, others, calls: [] };
  const db = openDb(':memory:');
  const fetchFn = fakeGitHub(state);
  const userId = upsertUser(
    db,
    { id: 1, login: 'alice', name: 'Alice', avatar_url: null, email: 'alice@example.test' },
    { accessToken: 'test-token', refreshToken: null, expiresAt: null },
  );
  const gh = () => new GitHub('test-token', fetchFn, API);
  const app = createApp(db, { githubFor: async () => gh(), fetchFn });
  const cookie = sessionCookie(db, userId);

  return {
    db,
    state,
    userId,
    app,
    sync: () => syncUser(db, userId, { gh: gh(), fetchFn }),
    /** Pretend the previous sync happened long ago so nothing is skipped as fresh. */
    age: () => db.prepare('UPDATE repos SET traffic_synced_at = NULL, detail_synced_at = NULL, meta_synced_at = NULL').run(),
    /** JSON request as the signed-in user. */
    api: async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
      const res = await app.request(path, {
        method,
        headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      let data: any = text;
      try {
        data = JSON.parse(text);
      } catch {
        // non-JSON response (CSV, SVG)
      }
      return { status: res.status, data, headers: res.headers };
    },
  };
}

export function sessionCookie(db: DB, userId: number): string {
  const token = randomToken();
  db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    sha256(token),
    userId,
    nowIso(),
    new Date(Date.now() + 3_600_000).toISOString(),
  );
  return `re_session=${token}`;
}
