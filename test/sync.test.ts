import { describe, expect, it, vi } from 'vitest';
import { addDays, dayOf } from '../src/server/db.ts';
import * as q from '../src/server/queries.ts';
import { setup } from './helpers.ts';

const today = dayOf();
const d = (ago: number) => addDays(today, -ago);

describe('traffic archiving', () => {
  it('keeps days after they leave the 14-day window and never lowers a day', async () => {
    const repo = { id: 10, owner: 'alice', name: 'lib', views: [[d(15), 40, 10], [d(14), 30, 9], [d(3), 5, 2]] as Array<[string, number, number]>, clones: [[d(14), 4, 3]] as Array<[string, number, number]> };
    const t = setup([repo]);
    await t.sync();

    // GitHub's window has moved on: the two oldest days are gone, one day grew, a new day appeared.
    repo.views = [[d(3), 8, 3], [d(1), 20, 6]];
    repo.clones = [[d(1), 2, 1]];
    t.age();
    await t.sync();

    const summary = q.repoSummaries(t.db, t.userId)[0]!;
    expect(summary.trafficLifetime).toEqual({ views: 40 + 30 + 8 + 20, uniques: 10 + 9 + 3 + 6, clones: 6, cloneUniques: 4 });
    expect(summary.trafficSince).toBe(d(15));
    expect(summary.traffic14d?.views).toBe(28);

    // a later, lower report for an archived day must not shrink it
    repo.views = [[d(3), 1, 1]];
    t.age();
    await t.sync();
    expect(q.repoSummaries(t.db, t.userId)[0]!.trafficLifetime?.views).toBe(98);
  });

  it('returns a zero-filled daily series with previous-period totals', async () => {
    const t = setup([{ id: 10, owner: 'alice', name: 'lib', views: [[d(20), 7, 2], [d(2), 5, 1]] }]);
    await t.sync();
    const series = q.trafficSeries(t.db, q.oneRepo(1), '14d');
    expect(series.points).toHaveLength(14);
    expect(series.points[0]!.day).toBe(d(13));
    expect(series.totals.views).toBe(5);
    expect(series.previous?.views).toBe(7);
    expect(q.trafficSeries(t.db, q.oneRepo(1), 'all').points[0]!.day).toBe(d(20));
  });

  it('skips traffic for repos without push access', async () => {
    const t = setup([{ id: 11, owner: 'someorg', name: 'readonly', permission: 'READ' }]);
    await t.sync();
    const summary = q.repoSummaries(t.db, t.userId)[0]!;
    expect(summary.canPush).toBe(false);
    expect(summary.tracked).toBe(false);
    expect(summary.trafficLifetime).toBeNull();
    expect(t.state.calls.some((c) => c.includes('/traffic/'))).toBe(false);
  });

  it('estimates lifetime referrers from snapshots 14 days apart', async () => {
    const t = setup([{ id: 10, owner: 'alice', name: 'lib', referrers: [['Google', 10, 5]] }]);
    await t.sync();
    const insert = t.db.prepare('INSERT INTO referrers_snap (repo_id, day, referrer, count, uniques) VALUES (1, ?, ?, ?, ?)');
    insert.run(d(7), 'Google', 100, 50); // overlaps today's window: ignored
    insert.run(d(14), 'Google', 30, 12);
    insert.run(d(14), 'reddit.com', 9, 4);
    insert.run(d(29), 'Google', 7, 3);
    expect(q.referrers(t.db, q.oneRepo(1), '14d').rows).toEqual([{ referrer: 'Google', count: 10, uniques: 5 }]);
    const all = q.referrers(t.db, q.oneRepo(1), 'all');
    expect(all.rows).toEqual([
      { referrer: 'Google', count: 47, uniques: 20 },
      { referrer: 'reddit.com', count: 9, uniques: 4 },
    ]);
    expect(all.since).toBe(d(42));
  });
});

describe('repo lifecycle', () => {
  it('hides repos that disappear but keeps their history, and restores them', async () => {
    const lib = { id: 10, owner: 'alice', name: 'lib', views: [[d(2), 9, 3]] as Array<[string, number, number]> };
    const t = setup([lib, { id: 12, owner: 'alice', name: 'other' }]);
    await t.sync();
    expect(q.repoSummaries(t.db, t.userId)).toHaveLength(2);

    t.state.repos = t.state.repos.filter((r) => r.id !== 10);
    await t.sync();
    expect(q.repoSummaries(t.db, t.userId).map((r) => r.name)).toEqual(['other']);
    expect((t.db.prepare('SELECT SUM(views) v FROM traffic_daily').get() as { v: number }).v).toBe(9);

    t.state.repos.push(lib);
    await t.sync();
    const restored = q.repoSummaries(t.db, t.userId).find((r) => r.name === 'lib')!;
    expect(restored.trafficLifetime?.views).toBe(9);
    expect(restored.tracked).toBe(true);
  });

  it('collects releases, commits and star history', async () => {
    const week = Math.floor(Date.parse(`${d(60)}T00:00:00Z`) / 1000);
    const t = setup([
      {
        id: 10, owner: 'alice', name: 'lib', stars: 12,
        releases: [{ id: 1, tag: 'v1.1', downloads: 70 }, { id: 2, tag: 'v1.0', downloads: 30 }],
        commits: [{ sha: 'a'.repeat(40), message: 'Second\n\nbody', date: `${d(1)}T10:00:00Z` }, { sha: 'b'.repeat(40), message: 'First', date: `${d(5)}T10:00:00Z` }],
        starWeeks: [[week, [3, 0, 0, 4, 0, 0, 0]]],
      },
    ]);
    await t.sync();

    const detail = q.repoDetail(t.db, t.userId, 1)!;
    expect(detail.releaseDownloads).toBe(100);
    expect(detail.releases.map((r) => r.tag).sort()).toEqual(['v1.0', 'v1.1']);
    expect(detail.starHistoryComplete).toBe(true);
    expect(q.commits(t.db, q.oneRepo(1), 10).map((c) => c.message)).toEqual(['Second', 'First']);

    // 12 stars today, 7 of them from the backfilled week: 5 before it, 8 after its first day, 12 after the second
    const stars = q.metricSeries(t.db, 1, 'all').points.map((p) => [p.day, p.stars, Boolean(p.backfilled)]);
    expect(stars).toEqual([
      [d(61), 5, true],
      [d(60), 8, true],
      [d(57), 12, true],
      [today, 12, false],
    ]);
    expect(q.metricSeries(t.db, 1, 'all').points.at(-1)!.releaseDownloads).toBe(100);

    // nothing new was pushed: commits are not fetched again
    t.state.calls.length = 0;
    t.age();
    await t.sync();
    expect(t.state.calls.filter((c) => c.endsWith('/commits'))).toHaveLength(0);
  });

  it('picks up commits that reach the default branch later with an older date', async () => {
    const repo = {
      id: 10, owner: 'alice', name: 'lib', pushedAt: `${d(3)}T12:00:00Z`,
      commits: [{ sha: 'a'.repeat(40), message: 'On main', date: `${d(3)}T10:00:00Z` }],
    };
    const t = setup([repo]);
    await t.sync();

    // a branch written a week before the newest stored commit is merged
    repo.commits.push(
      { sha: 'b'.repeat(40), message: 'From the branch', date: `${d(10)}T10:00:00Z` },
      { sha: 'c'.repeat(40), message: 'Merge', date: `${d(1)}T10:00:00Z` },
    );
    repo.pushedAt = `${d(1)}T10:00:00Z`;
    await t.sync();
    expect(q.commits(t.db, q.oneRepo(1), 10).map((c) => c.message)).toEqual(['Merge', 'On main', 'From the branch']);
  });
});

describe('codeberg', () => {
  it('pages through commits only until a page holds nothing new', async () => {
    // one commit a day for 120 days; Codeberg serves 50 per page and has no `since` filter
    const commits = Array.from({ length: 120 }, (_, i) => ({ sha: String(i).padStart(40, '0'), message: `Commit ${i}`, date: `${d(i)}T10:00:00+02:00` }));
    const berg = { id: 30, owner: 'vendor', name: 'tool', commits, pushedAt: `${d(0)}T10:00:00+02:00` };
    const t = setup([{ id: 10, owner: 'alice', name: 'lib' }]);
    t.state.codeberg = [berg];
    await t.sync();

    const { data } = await t.api('POST', '/api/repos/follow', { fullName: 'codeberg.org/vendor/tool' });
    const stored = () => (t.db.prepare('SELECT COUNT(*) n FROM commits WHERE repo_id = ?').get(data.id) as { n: number }).n;
    await vi.waitFor(() => expect(stored()).toBe(120));

    berg.commits.push({ sha: 'f'.repeat(40), message: 'Newest', date: `${today}T22:00:00+02:00` });
    berg.pushedAt = `${today}T22:00:00+02:00`;
    t.state.calls.length = 0;
    t.age();
    await t.sync();
    expect(stored()).toBe(121);
    // page 1 holds the new commit, page 2 is entirely older than the 30-day overlap, page 3 is never asked for
    expect(t.state.calls.filter((c) => c === 'GET /api/v1/repos/vendor/tool/commits')).toHaveLength(2);
  });
});

describe('star history', () => {
  it('feeds the 30-day delta, sparkline and range charts before snapshots exist', async () => {
    // a Sunday-aligned week is not needed here: the fake returns whatever week start it is given
    const week = Math.floor(Date.parse(`${d(20)}T00:00:00Z`) / 1000);
    const t = setup([
      { id: 10, owner: 'alice', name: 'lib', stars: 12, starWeeks: [[week, [3, 0, 0, 4, 0, 0, 0]]] },
      { id: 11, owner: 'alice', name: 'quiet', stars: 2 },
    ]);
    await t.sync();

    const lib = q.repoSummaries(t.db, t.userId).find((r) => r.name === 'lib')!;
    expect(lib.starsDelta30d).toBe(7);
    expect(lib.starsSpark[0]).toBe(5);
    expect(lib.starsSpark.at(-1)).toBe(12);
    expect(lib.starsSpark).toHaveLength(22); // from the day before the first star in range until today

    // a 14-day chart starts at the left edge with the value carried in from before the range
    const points = q.metricSeries(t.db, lib.id, '14d').points.map((p) => [p.day, p.stars]);
    expect(points).toEqual([[d(13), 12], [today, 12]]);

    const overview = q.overview(t.db, t.userId, '30d');
    expect(overview.stars).toBe(14);
    expect(overview.starsDelta).toBe(7);
    expect(overview.starSeries.at(-1)).toEqual({ day: today, stars: 14 });
  });
});

describe('failures', () => {
  it('records a rate limit and leaves the last successful sync untouched', async () => {
    const t = setup([{ id: 10, owner: 'alice', name: 'lib' }]);
    t.state.failWith = { status: 403, headers: { 'x-ratelimit-remaining': '0' }, message: 'API rate limit exceeded' };
    await t.sync();
    const user = t.db.prepare('SELECT * FROM users WHERE id = ?').get(t.userId) as any;
    expect(user.last_sync_at).toBeNull();
    expect(user.last_sync_error).toContain('rate limit');
    expect(user.token_invalid).toBe(0);
  });

  it('flags a revoked token', async () => {
    const t = setup([{ id: 10, owner: 'alice', name: 'lib' }]);
    t.state.failWith = { status: 401, message: 'Bad credentials' };
    await t.sync();
    const user = t.db.prepare('SELECT * FROM users WHERE id = ?').get(t.userId) as any;
    expect(user.token_invalid).toBe(1);
    expect(user.last_sync_error).toContain('Sign in again');
  });
});

describe('events', () => {
  it('records a star milestone once and posts it to the webhook', async () => {
    const repo = { id: 10, owner: 'alice', name: 'lib', stars: 95 };
    const t = setup([repo]);
    await t.sync();
    t.db.prepare('UPDATE metrics_daily SET day = ?').run(d(1));
    t.db.prepare('UPDATE users SET settings_json = ? WHERE id = ?').run(JSON.stringify({ webhookUrl: 'https://93.184.216.34/in' }), t.userId);

    repo.stars = 104;
    await t.sync();
    await t.sync();

    const events = q.events(t.db, t.userId, 10);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'star-milestone', title: 'alice/lib reached 100 stars' });
    expect(t.state.calls.filter((c) => c === 'POST /in')).toHaveLength(1);
  });

  it('flags a traffic spike against the previous two weeks', async () => {
    const quiet = Array.from({ length: 12 }, (_, i) => [d(i + 2), 4, 2] as [string, number, number]);
    const t = setup([{ id: 10, owner: 'alice', name: 'lib', views: [...quiet, [d(1), 90, 40]] }]);
    await t.sync();
    expect(q.events(t.db, t.userId, 10).map((e) => e.kind)).toEqual(['traffic-spike']);
  });
});
