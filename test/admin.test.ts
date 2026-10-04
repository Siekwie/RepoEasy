import { beforeAll, describe, expect, it } from 'vitest';

// Admins and the operator come from configuration, which is read at import time,
// so the modules are loaded only after the environment is prepared.
process.env.ADMIN_LOGINS = 'alice';
process.env.OPERATOR_NAME = 'Ada Example';
process.env.OPERATOR_ADDRESS = 'Main Street 1; 12345 Sampletown';
process.env.OPERATOR_LINKS = 'Blog=https://blog.example.test, broken=javascript:alert(1)';

let setup: typeof import('./helpers.ts').setup;
let sessionCookie: typeof import('./helpers.ts').sessionCookie;
let upsertUser: typeof import('../src/server/tokens.ts').upsertUser;
let seedDemo: typeof import('../src/server/demo.ts').seedDemo;
let visits: typeof import('../src/server/visits.ts');

beforeAll(async () => {
  ({ setup, sessionCookie } = await import('./helpers.ts'));
  ({ upsertUser } = await import('../src/server/tokens.ts'));
  ({ seedDemo } = await import('../src/server/demo.ts'));
  visits = await import('../src/server/visits.ts');
});

const own = { id: 10, owner: 'alice', name: 'lib' };
type App = ReturnType<typeof setup>['app'];
const hit = (app: App, body: unknown) =>
  app.request('/api/hit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const counts = (t: ReturnType<typeof setup>) =>
  Object.fromEntries(
    (t.db.prepare('SELECT kind, source, count FROM visits ORDER BY kind, source').all() as Array<{ kind: string; source: string; count: number }>).map((r) => [
      `${r.kind}:${r.source}`,
      r.count,
    ]),
  );

describe('visit counter', () => {
  it('counts landing-page views by source without a session', async () => {
    const t = setup([own]);
    expect(await (await hit(t.app, { ref: 'Dev.to', referrer: 'https://www.google.com/search?q=x' })).json()).toEqual({ source: 'dev.to' });
    expect(await (await hit(t.app, { ref: '', referrer: 'https://www.google.com/search?q=x' })).json()).toEqual({ source: 'google.com' });
    // the site's own pages and unusable tags are not a source
    expect(await (await hit(t.app, { ref: '<script>', referrer: 'http://localhost:8787/settings' })).json()).toEqual({ source: '' });
    await hit(t.app, { ref: 'dev.to' });
    expect(counts(t)).toEqual({ 'landing:': 1, 'landing:dev.to': 2, 'landing:google.com': 1 });
  });

  it('caps what one address can add', () => {
    const now = Date.now();
    for (let i = 0; i < 20; i++) expect(visits.hitAllowed('198.51.100.7', now)).toBe(true);
    expect(visits.hitAllowed('198.51.100.7', now)).toBe(false);
    expect(visits.hitAllowed('198.51.100.8', now)).toBe(true);
    expect(visits.hitAllowed('198.51.100.7', now + 3_600_001)).toBe(true);
  });

  it('credits a new account to the source its sign-in started from, once', async () => {
    const t = setup([own]);
    t.db.prepare('DELETE FROM users').run();
    const signIn = async (src: string) => {
      const start = await t.app.request(`/auth/github?src=${src}`);
      const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
      const cookie = start.headers.get('set-cookie')!.split(';')[0]!;
      return t.app.request(`/auth/github/callback?code=good-code&state=${state}`, { headers: { cookie } });
    };
    expect((await signIn('dev.to')).headers.get('location')).toBe('/');
    expect((await signIn('reddit')).headers.get('location')).toBe('/');
    expect(t.db.prepare('SELECT signup_source FROM users').all()).toEqual([{ signup_source: 'dev.to' }]);
    expect(counts(t)).toEqual({ 'signin:dev.to': 1, 'signin:reddit': 1, 'signup:dev.to': 1 });
  });
});

describe('admin', () => {
  it('is only there for accounts in ADMIN_LOGINS', async () => {
    const t = setup([own]);
    const bob = upsertUser(
      t.db,
      { id: 2, login: 'bob', name: null, avatar_url: null, email: null },
      { accessToken: 'bob-token', refreshToken: null, expiresAt: null },
    );
    const asBob = { headers: { cookie: sessionCookie(t.db, bob) } };
    expect(((await (await t.app.request('/api/me', asBob)).json()) as any).isAdmin).toBe(false);
    expect((await t.app.request('/api/admin/stats', asBob)).status).toBe(404);
    expect((await t.app.request('/api/admin/stats')).status).toBe(401);
    expect((await t.api('GET', '/api/me')).data.isAdmin).toBe(true);
    expect((await t.api('GET', '/api/admin/stats')).status).toBe(200);
  });

  it('reports accounts, usage and the funnel, leaving the demo account out', async () => {
    const t = setup([own]);
    await t.sync();
    seedDemo(t.db);
    upsertUser(t.db, { id: 2, login: 'bob', name: null, avatar_url: null, email: null }, { accessToken: 'x', refreshToken: null, expiresAt: null });
    t.db.prepare(`UPDATE users SET signup_source = 'dev.to', last_sync_error = 'rate limited' WHERE login = 'bob'`).run();
    visits.recordVisit(t.db, 'landing', 'dev.to');
    visits.recordVisit(t.db, 'landing', 'dev.to');
    visits.recordVisit(t.db, 'landing', '');
    visits.recordVisit(t.db, 'signup', 'dev.to');

    const { data } = await t.api('GET', '/api/admin/stats');
    expect(data.accounts).toMatchObject({ total: 2, new7d: 2, active7d: 2, problems: 1 });
    expect(data.repos).toEqual({ tracked: 1, followed: 0, shared: 0 });
    expect(data.funnel.totals).toEqual({ landing: 3, signin: 0, demo: 0, signup: 1 });
    expect(data.funnel.daily).toHaveLength(30);
    expect(data.funnel.daily.at(-1)).toMatchObject({ landing: 3, signup: 1 });
    expect(data.funnel.sources).toEqual([
      { source: 'dev.to', landing: 2, signin: 0, demo: 0, signup: 1 },
      { source: '', landing: 1, signin: 0, demo: 0, signup: 0 },
    ]);
    expect(data.users.map((u: any) => [u.login, u.plan, u.source, u.tracked])).toEqual(
      expect.arrayContaining([
        ['alice', 'admin', null, 1],
        ['bob', 'selfhost', 'dev.to', 0],
      ]),
    );
    expect(data.users).toHaveLength(2);
    // GitHub tokens and email addresses stay out of the response
    expect(JSON.stringify(data)).not.toMatch(/token|example\.test/);
  });
});

describe('operator', () => {
  it('is published with the instance info for the legal pages', async () => {
    const t = setup([own]);
    const info: any = await (await t.app.request('/api/info')).json();
    expect(info.operator).toEqual({ name: 'Ada Example', address: ['Main Street 1', '12345 Sampletown'], email: null, hosting: null, backupDays: 7 });
    expect(info.links).toEqual([{ label: 'Blog', url: 'https://blog.example.test' }]);
  });
});
