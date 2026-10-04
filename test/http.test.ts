import { describe, expect, it, vi } from 'vitest';
import { decrypt } from '../src/server/crypto.ts';
import { addDays, dayOf } from '../src/server/db.ts';
import { seedDemo } from '../src/server/demo.ts';
import { sessionCookie, setup } from './helpers.ts';

const today = dayOf();
const own = { id: 10, owner: 'alice', name: 'lib', stars: 12, views: [[addDays(today, -2), 9, 3]] as Array<[string, number, number]> };
const publicRepo = { id: 20, owner: 'vendor', name: 'tool', stars: 5000 };
const privateRepo = { id: 21, owner: 'vendor', name: 'secret', private: true };

describe('auth', () => {
  it('rejects anonymous API calls but serves /api/info', async () => {
    const t = setup([own]);
    expect((await t.app.request('/api/me')).status).toBe(401);
    const info: any = await (await t.app.request("/api/info")).json();
    expect(info).toMatchObject({ name: 'RepoEasy', billing: { enabled: false } });
  });

  it('signs in through the GitHub OAuth flow and stores the token encrypted', async () => {
    const t = setup([own]);
    t.db.prepare('DELETE FROM users').run();

    const start = await t.app.request('/auth/github');
    expect(start.status).toBe(302);
    const authorize = new URL(start.headers.get('location')!);
    expect(authorize.origin + authorize.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(authorize.searchParams.get('client_id')).toBe('test-client');
    expect(authorize.searchParams.get('scope')).toBe('read:user repo');
    expect(authorize.searchParams.get('redirect_uri')).toBe('http://localhost:8787/auth/github/callback');
    const state = authorize.searchParams.get('state')!;
    const stateCookie = start.headers.get('set-cookie')!.split(';')[0]!;

    const forged = await t.app.request(`/auth/github/callback?code=good-code&state=forged`, { headers: { cookie: stateCookie } });
    expect(forged.headers.get('location')).toBe('/?error=login-failed');
    const rejected = await t.app.request(`/auth/github/callback?code=bad-code&state=${state}`, { headers: { cookie: stateCookie } });
    expect(rejected.headers.get('location')).toBe('/?error=login-failed');
    expect((t.db.prepare('SELECT COUNT(*) n FROM users').get() as { n: number }).n).toBe(0);

    const ok = await t.app.request(`/auth/github/callback?code=good-code&state=${state}`, { headers: { cookie: stateCookie } });
    expect(ok.headers.get('location')).toBe('/');
    const session = ok.headers.getSetCookie().find((c) => c.startsWith('re_session='))!;
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/SameSite=Lax/i);
    const me: any = await (await t.app.request('/api/me', { headers: { cookie: session.split(';')[0]! } })).json();
    expect(me.login).toBe('alice');

    const row = t.db.prepare('SELECT token_enc FROM users').get() as { token_enc: string };
    expect(row.token_enc).not.toContain('oauth-token');
    expect(decrypt(row.token_enc)).toBe('oauth-token');

    // the sync kicked off by signing in finds the account's repositories
    await vi.waitFor(async () => {
      const repos: any = await (await t.app.request('/api/repos', { headers: { cookie: session.split(';')[0]! } })).json();
      expect(repos.map((r: any) => r.fullName)).toEqual(['alice/lib']);
    });
  });

  it('refuses requests addressed to an unknown hostname (DNS rebinding)', async () => {
    const t = setup([own]);
    const res = await t.app.request('http://attacker.example/api/me', { headers: { cookie: 'x=y' } });
    expect(res.status).toBe(403);
    expect((await t.app.request('http://attacker.example/auth/local', { method: 'POST' })).status).toBe(403);
    expect((await t.app.request('http://127.0.0.1:8787/api/info')).status).toBe(200);
  });

  it('limits request bodies', async () => {
    const t = setup([own]);
    const res = await t.api('PATCH', '/api/repos/1', { note: 'x'.repeat(100_000) });
    expect(res.status).toBe(400);
  });

  it('blocks cross-site writes', async () => {
    const t = setup([own]);
    const res = await t.api('POST', '/auth/logout', undefined, { origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect((await t.api('GET', '/api/me')).status).toBe(200);
  });

  it('accepts API tokens as bearer credentials', async () => {
    const t = setup([own]);
    const created = await t.api('POST', '/api/tokens', { name: 'ci' });
    expect(created.status).toBe(201);
    expect(created.data.token).toMatch(/^re_/);
    const res = await t.app.request('/api/me', { headers: { authorization: `Bearer ${created.data.token}` } });
    expect(((await res.json()) as any).login).toBe('alice');
    const listed = await t.api('GET', '/api/tokens');
    expect(listed.data[0]).not.toHaveProperty('token');
    expect(listed.data[0].lastUsedAt).not.toBeNull();
    expect((await t.app.request('/api/me', { headers: { authorization: 'Bearer re_wrong' } })).status).toBe(401);

    // tokens read; they cannot change or delete anything
    const write = await t.app.request('/api/me', { method: 'DELETE', headers: { authorization: `Bearer ${created.data.token}` } });
    expect(write.status).toBe(403);
    expect((t.db.prepare('SELECT COUNT(*) n FROM users').get() as { n: number }).n).toBe(1);
  });

  it('keeps the demo account read-only', async () => {
    const t = setup([own]);
    seedDemo(t.db);
    const demo = t.db.prepare('SELECT id FROM users WHERE is_demo = 1').get() as { id: number };
    const cookie = sessionCookie(t.db, demo.id);
    const read = await t.app.request('/api/overview?range=90d', { headers: { cookie } });
    expect(read.status).toBe(200);
    expect(((await read.json()) as any).lifetime.views).toBeGreaterThan(1000);
    const write = await t.app.request('/api/sync', { method: 'POST', headers: { cookie } });
    expect(write.status).toBe(403);
    expect(((await write.json()) as any).code).toBe('demo-readonly');
  });
});

describe('repos', () => {
  it('follows and unfollows public repositories', async () => {
    const t = setup([own], [publicRepo, privateRepo]);
    await t.sync();

    const followed = await t.api('POST', '/api/repos/follow', { fullName: 'https://github.com/vendor/tool/issues' });
    expect(followed.status).toBe(201);
    expect(followed.data).toMatchObject({ fullName: 'vendor/tool', relation: 'followed', stars: 5000, traffic14d: null, viewsSpark: [] });

    expect((await t.api('POST', '/api/repos/follow', { fullName: 'vendor/tool' })).status).toBe(200);
    expect((await t.api('POST', '/api/repos/follow', { fullName: 'vendor/secret' })).data.code).toBe('bad-request');
    expect((await t.api('POST', '/api/repos/follow', { fullName: 'vendor/missing' })).status).toBe(404);
    expect((await t.api('POST', '/api/repos/follow', { fullName: 'alice/lib' })).data.error).toContain('already');
    expect((await t.api('POST', '/api/repos/follow', { fullName: 'not a repo' })).status).toBe(400);

    const id = followed.data.id;
    expect((await t.api('PATCH', `/api/repos/${id}`, { tracked: true })).status).toBe(400);
    expect((await t.api('GET', `/api/repos/${id}/traffic`)).data.totals.views).toBe(0);

    // a later sync refreshes followed repos and keeps them out of the own-repo totals
    publicRepo.stars = 5100;
    t.age();
    await t.sync();
    const list = (await t.api('GET', '/api/repos')).data;
    expect(list.find((r: any) => r.id === id).stars).toBe(5100);
    const overview = (await t.api('GET', '/api/overview')).data;
    expect(overview).toMatchObject({ repoCount: 1, followedCount: 1, stars: 12 });

    expect((await t.api('DELETE', `/api/repos/${id}/follow`)).status).toBe(200);
    expect((await t.api('GET', `/api/repos/${id}`)).status).toBe(404);
  });

  it('follows Codeberg repositories next to GitHub ones, without traffic or star history', async () => {
    // same owner/name and the same numeric id as the GitHub repository: the two must not collide
    const berg = {
      id: 20, owner: 'vendor', name: 'tool', stars: 40,
      releases: [{ id: 5, tag: 'v2.0', downloads: 7, publishedAt: '2026-03-01T01:30:00+02:00' }],
      commits: [{ sha: 'c'.repeat(40), message: 'On Codeberg', date: '2026-03-01T01:30:00+02:00' }],
    };
    const t = setup([own], [publicRepo]);
    t.state.codeberg = [berg];
    await t.sync();
    t.state.calls.length = 0;

    const followed = await t.api('POST', '/api/repos/follow', { fullName: 'https://codeberg.org/vendor/tool' });
    expect(followed.status).toBe(201);
    expect(followed.data).toMatchObject({
      host: 'codeberg', fullName: 'vendor/tool', htmlUrl: 'https://codeberg.org/vendor/tool', relation: 'followed',
      stars: 40, language: 'Go', topics: ['forge'], ciState: 'SUCCESS', traffic14d: null,
      latestRelease: { tag: 'v2.0', publishedAt: '2026-02-28T23:30:00Z' },
      // Codeberg reports neither README nor license, so neither is held against the repository
      health: { issues: [] },
    });
    const id = followed.data.id;

    // releases and commits arrive in the background, with times in UTC and source archives counted as downloads
    await vi.waitFor(async () => {
      const detail = (await t.api('GET', `/api/repos/${id}`)).data;
      expect(detail.releaseDownloads).toBe(7 + 1 + 2);
      expect(detail.releases[0]).toMatchObject({ tag: 'v2.0', publishedAt: '2026-02-28T23:30:00Z' });
      expect(detail.languages.map((l: any) => l.name)).toEqual(['Go', 'Shell']);
      const commits = (await t.api('GET', `/api/repos/${id}/commits`)).data;
      expect(commits[0]).toMatchObject({ message: 'On Codeberg', committedAt: '2026-02-28T23:30:00Z', authorLogin: 'berg' });
    });
    // GitHub was not involved, and nothing asked Codeberg for traffic or star dates
    expect(t.state.calls.every((c) => c.startsWith('GET /api/v1/repos/vendor/tool'))).toBe(true);
    expect(t.state.calls.some((c) => /traffic|stargazers/.test(c))).toBe(false);

    const onGitHub = await t.api('POST', '/api/repos/follow', { fullName: 'vendor/tool' });
    expect(onGitHub.data).toMatchObject({ host: 'github', stars: publicRepo.stars });
    expect(onGitHub.data.id).not.toBe(id);
    expect((await t.api('POST', '/api/repos/follow', { fullName: 'codeberg.org/vendor/tool' })).status).toBe(200);
    expect((await t.api('POST', '/api/repos/follow', { fullName: 'codeberg.org/vendor/missing' })).data.error).toContain('not found on Codeberg');

    // the account's sync refreshes it
    berg.stars = 55;
    t.age();
    await t.sync();
    expect((await t.api('GET', `/api/repos/${id}`)).data).toMatchObject({ stars: 55, starHistoryComplete: false });
    expect((await t.api('GET', '/api/overview')).data).toMatchObject({ repoCount: 1, followedCount: 2, stars: 12 });

    // Codeberg refusing requests leaves the sync and the archived numbers alone
    t.state.codebergFails = 429;
    t.age();
    await t.sync();
    const user = t.db.prepare('SELECT last_sync_error, token_invalid FROM users WHERE id = ?').get(t.userId);
    expect(user).toEqual({ last_sync_error: null, token_invalid: 0 });
    expect((await t.api('GET', `/api/repos/${id}`)).data.stars).toBe(55);

    expect((await t.api('DELETE', `/api/repos/${id}/follow`)).status).toBe(200);
    expect((await t.api('GET', '/api/repos')).data.map((r: any) => r.host)).toEqual(['github', 'github']);
  });

  it('updates tags, notes and flags per user', async () => {
    const t = setup([own]);
    await t.sync();
    const res = await t.api('PATCH', '/api/repos/1', { tags: [' oss ', 'oss', 'x'.repeat(50)], note: ' hello ', pinned: true, tracked: false });
    expect(res.data).toMatchObject({ tags: ['oss', 'x'.repeat(30)], note: 'hello', pinned: true, tracked: false });
    expect((await t.api('PATCH', '/api/repos/1', { tags: 'nope' })).status).toBe(400);
    expect((await t.api('PATCH', '/api/repos/999', { pinned: true })).status).toBe(404);
  });

  it('writes description and topics through to GitHub', async () => {
    const t = setup([own]);
    await t.sync();
    t.state.calls.length = 0;
    const res = await t.api('PATCH', '/api/repos/1/github', { description: 'New words', topics: ['Cache', 'lru'] });
    expect(res.data).toMatchObject({ description: 'New words', topics: ['cache', 'lru'] });
    expect(t.state.calls).toEqual(expect.arrayContaining(['PATCH /repos/alice/lib', 'PUT /repos/alice/lib/topics']));
    expect((await t.api('PATCH', '/api/repos/1/github', { topics: ['bad topic!'] })).status).toBe(400);
  });

  it('exports CSV and the full account as JSON', async () => {
    const t = setup([own]);
    await t.sync();
    const csv = await t.api('GET', '/api/repos/1/export.csv?kind=traffic');
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect(csv.data).toBe(`day,views,unique_visitors,clones,unique_cloners\r\n${addDays(today, -2)},9,3,0,0\r\n`);
    const dump = (await t.api('GET', '/api/export.json')).data;
    expect(dump.account.login).toBe('alice');
    expect(dump.repos[0].traffic).toEqual([{ day: addDays(today, -2), views: 9, uniques: 3, clones: 0, cloneUniques: 0 }]);
    expect(JSON.stringify(dump)).not.toContain('test-token');
  });
});

describe('sharing', () => {
  it('serves badges and public stats only while sharing is on', async () => {
    const t = setup([own]);
    await t.sync();
    expect((await t.app.request('/api/public/alice/lib')).status).toBe(404);
    expect((await t.app.request('/badge/alice/lib/views.svg')).status).toBe(404);

    expect((await t.api('PATCH', '/api/repos/1', { shareEnabled: true })).data.shareEnabled).toBe(true);
    expect((await t.api('GET', '/api/repos/1')).data.canAdmin).toBe(true);
    const stats = await (await t.app.request('/api/public/ALICE/lib')).json();
    expect(stats).toMatchObject({ fullName: 'alice/lib', lifetime: { views: 9 } });
    const badge = await t.app.request('/badge/alice/lib/views.svg');
    expect(badge.headers.get('content-type')).toContain('image/svg+xml');
    expect(await badge.text()).toContain('>9<');
    expect((await t.app.request('/badge/alice/lib/bogus.svg')).status).toBe(404);
  });
});

describe('private repositories', () => {
  it('are never shared, and stop being shared or followed once they turn private', async () => {
    const secret = { id: 30, owner: 'alice', name: 'secret', private: true, views: [[addDays(today, -1), 4, 2]] as Array<[string, number, number]> };
    const open = { id: 31, owner: 'alice', name: 'open', private: false };
    const t = setup([secret, open]);
    await t.sync();
    const ids = Object.fromEntries((await t.api('GET', '/api/repos')).data.map((r: any) => [r.name, r.id]));

    expect((await t.api('PATCH', `/api/repos/${ids.secret}`, { shareEnabled: true })).status).toBe(400);
    expect((await t.app.request('/api/public/alice/secret')).status).toBe(404);

    // someone else follows the public repo, and its owner shares it
    const bob = t.db.prepare(`INSERT INTO users (github_id, login, created_at) VALUES (2, 'bob', ?) RETURNING id`).get(new Date().toISOString()) as { id: number };
    t.db.prepare(`INSERT INTO user_repos (user_id, repo_id, relation, added_at) VALUES (?, ?, 'followed', ?)`).run(bob.id, ids.open, new Date().toISOString());
    const bobCookie = sessionCookie(t.db, bob.id);
    await t.api('PATCH', `/api/repos/${ids.open}`, { shareEnabled: true });
    expect((await t.app.request('/api/public/alice/open')).status).toBe(200);
    expect((await t.app.request(`/api/repos/${ids.open}`, { headers: { cookie: bobCookie } })).status).toBe(200);

    // the owner makes it private: the next sync takes it away from the follower and from the public
    open.private = true;
    t.age();
    await t.sync();
    expect((await t.app.request(`/api/repos/${ids.open}`, { headers: { cookie: bobCookie } })).status).toBe(404);
    expect((await t.app.request(`/api/repos/${ids.open}/commits`, { headers: { cookie: bobCookie } })).status).toBe(404);
    expect((await t.app.request('/api/public/alice/open')).status).toBe(404);
    expect((await t.app.request('/badge/alice/open/views.svg')).status).toBe(404);
    expect((await t.api('GET', `/api/repos/${ids.open}`)).data.shareEnabled).toBe(false);
  });

  it('are hidden from an account whose GitHub access was revoked, and come back after signing in again', async () => {
    const secret = { id: 30, owner: 'alice', name: 'secret', private: true };
    const open = { id: 31, owner: 'alice', name: 'open' };
    const t = setup([secret, open]);
    await t.sync();
    expect((await t.api('GET', '/api/repos')).data).toHaveLength(2);

    t.state.failWith = { status: 401, message: 'Bad credentials' };
    await t.sync();
    expect((await t.api('GET', '/api/repos')).data.map((r: any) => r.name)).toEqual(['open']);

    t.state.failWith = undefined;
    await t.sync();
    expect((await t.api('GET', '/api/repos')).data).toHaveLength(2);
  });
});

describe('account', () => {
  it('deletes the account together with data nobody else can see', async () => {
    const t = setup([own]);
    await t.sync();
    expect((await t.api('DELETE', '/api/me')).status).toBe(200);
    expect((await t.api('GET', '/api/me')).status).toBe(401);
    for (const table of ['users', 'repos', 'traffic_daily', 'metrics_daily', 'sessions']) {
      expect((t.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as { n: number }).n, table).toBe(0);
    }
  });

  it('validates webhook settings', async () => {
    const t = setup([own]);
    expect((await t.api('PATCH', '/api/me/settings', { webhookUrl: 'ftp://x' })).status).toBe(400);
    const ok = await t.api('PATCH', '/api/me/settings', { webhookUrl: 'https://93.184.216.34/a', notifySpikes: false });
    expect(ok.data.settings).toMatchObject({ webhookUrl: 'https://93.184.216.34/a', notifySpikes: false, notifyMilestones: true });
  });
});
