import { beforeAll, describe, expect, it } from 'vitest';

// Billing is switched on by configuration, which is read at import time,
// so the modules are loaded only after the environment is prepared.
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

let setup: typeof import('./helpers.ts').setup;
let applyStripeEvent: typeof import('../src/server/billing.ts').applyStripeEvent;
let dueUsers: typeof import('../src/server/scheduler.ts').dueUsers;
let overdue: typeof import('../src/server/scheduler.ts').overdue;
let enforceLimits: typeof import('../src/server/sync.ts').enforceLimits;

beforeAll(async () => {
  ({ setup } = await import('./helpers.ts'));
  ({ applyStripeEvent } = await import('../src/server/billing.ts'));
  ({ dueUsers, overdue } = await import('../src/server/scheduler.ts'));
  ({ enforceLimits } = await import('../src/server/sync.ts'));
});

const repos = () => [1, 2, 3, 4, 5].map((n) => ({ id: n, owner: 'alice', name: `repo${n}` }));
const subscription = (type: string, status: string) => ({
  type,
  data: { object: { id: 'sub_1', customer: 'cus_1', status, current_period_end: Math.floor(Date.now() / 1000) + 30 * 86_400 } },
});

describe('plans', () => {
  it('limits the free plan and unlocks Pro through Stripe events', async () => {
    const t = setup(repos(), [
      ...Array.from({ length: 11 }, (_, i) => ({ id: 100 + i, owner: 'vendor', name: `pub${i}` })),
    ]);
    await t.sync();

    let me = (await t.api('GET', '/api/me')).data;
    expect(me.plan).toBe('free');
    expect(me.usage.tracked).toBe(3);

    const untracked = (await t.api('GET', '/api/repos')).data.find((r: any) => !r.tracked);
    const denied = await t.api('PATCH', `/api/repos/${untracked.id}`, { tracked: true });
    expect(denied.status).toBe(402);
    expect(denied.data.code).toBe('plan-limit');
    expect((await t.api('POST', '/api/tokens', { name: 'x' })).data.code).toBe('plan-limit');
    expect((await t.api('PATCH', '/api/me/settings', { webhookUrl: 'https://example.com/hook' })).data.code).toBe('plan-limit');
    expect((await t.api('PATCH', '/api/repos/1', { shareEnabled: true })).data.code).toBe('plan-limit');

    for (let i = 0; i < 10; i++) expect((await t.api('POST', '/api/repos/follow', { fullName: `vendor/pub${i}` })).status).toBe(201);
    expect((await t.api('POST', '/api/repos/follow', { fullName: 'vendor/pub10' })).data.code).toBe('plan-limit');

    // checkout completes, then Stripe confirms the subscription
    applyStripeEvent(t.db, { type: 'checkout.session.completed', data: { object: { client_reference_id: `${t.userId}:1`, customer: 'cus_1', subscription: 'sub_1', mode: 'subscription', payment_status: 'paid' } } });
    applyStripeEvent(t.db, subscription('customer.subscription.updated', 'active'));
    me = (await t.api('GET', '/api/me')).data;
    expect(me.plan).toBe('pro');
    expect(me.billing.hasSubscription).toBe(true);
    expect((await t.api('PATCH', `/api/repos/${untracked.id}`, { tracked: true })).data.tracked).toBe(true);
    expect((await t.api('POST', '/api/repos/follow', { fullName: 'vendor/pub10' })).status).toBe(201);
    const token = (await t.api('POST', '/api/tokens', { name: 'x' })).data.token;
    expect((await t.app.request('/api/me', { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
    expect((await t.api('PATCH', '/api/repos/1', { shareEnabled: true })).data.shareEnabled).toBe(true);
    // a second checkout is refused while a subscription exists
    expect((await t.api('POST', '/api/billing/checkout', { interval: 'month' })).status).toBe(400);
    // an event about a different, stale subscription changes nothing
    applyStripeEvent(t.db, { type: 'customer.subscription.deleted', data: { object: { id: 'sub_old', customer: 'cus_1', status: 'canceled' } } });
    expect((await t.api('GET', '/api/me')).data.plan).toBe('pro');

    // cancelling drops back to free and trims tracking to the limit, keeping pinned repos
    await t.api('PATCH', `/api/repos/${untracked.id}`, { pinned: true });
    applyStripeEvent(t.db, subscription('customer.subscription.deleted', 'canceled'));
    me = (await t.api('GET', '/api/me')).data;
    expect(me.plan).toBe('free');
    expect(me.usage.tracked).toBe(3);
    const list = (await t.api('GET', '/api/repos')).data;
    expect(list.find((r: any) => r.id === untracked.id).tracked).toBe(true);
    // nothing is deleted on downgrade
    expect(list.filter((r: any) => r.relation === 'followed')).toHaveLength(11);
    // Pro-only features stop: the API token no longer works and the share page is gone
    expect((await t.app.request('/api/me', { headers: { authorization: `Bearer ${token}` } })).status).toBe(402);
    expect((await t.app.request('/api/public/alice/repo1')).status).toBe(404);
  });

  it('ignores checkouts that are unpaid or reference an account that no longer matches', async () => {
    const t = setup(repos());
    const checkout = (object: Record<string, unknown>) =>
      applyStripeEvent(t.db, { type: 'checkout.session.completed', data: { object: { customer: 'cus_9', subscription: 'sub_9', mode: 'subscription', payment_status: 'paid', ...object } } });
    const plan = async () => (await t.api('GET', '/api/me')).data.plan;

    checkout({ client_reference_id: `${t.userId}:1`, payment_status: 'unpaid' });
    expect(await plan()).toBe('free');
    checkout({ client_reference_id: `${t.userId}:999` }); // row id reused by a different GitHub account
    expect(await plan()).toBe('free');
    checkout({ client_reference_id: String(t.userId) });
    expect(await plan()).toBe('free');
    checkout({ client_reference_id: `${t.userId}:1` });
    expect(await plan()).toBe('pro');
  });

  it('cancels the subscription when the account is deleted', async () => {
    const t = setup(repos());
    applyStripeEvent(t.db, { type: 'checkout.session.completed', data: { object: { client_reference_id: `${t.userId}:1`, customer: 'cus_1', subscription: 'sub_1', mode: 'subscription', payment_status: 'paid' } } });
    expect((await t.api('DELETE', '/api/me')).status).toBe(200);
    expect(t.state.calls).toContain('DELETE /v1/subscriptions/sub_1');
  });

  it('rejects unsigned webhooks', async () => {
    const t = setup(repos());
    const res = await t.app.request('/api/billing/webhook', { method: 'POST', body: '{}', headers: { 'stripe-signature': 't=1,v1=bad' } });
    expect(res.status).toBe(403);
  });

  it('schedules free accounts daily and backs off after a failed attempt', async () => {
    const t = setup(repos());
    const hours = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
    const set = (synced: string | null, started: string | null) =>
      t.db.prepare('UPDATE users SET last_sync_at = ?, last_sync_started_at = ? WHERE id = ?').run(synced, started, t.userId);

    set(null, null);
    expect(dueUsers(t.db)).toHaveLength(1);
    set(hours(7), hours(7));
    expect(dueUsers(t.db)).toHaveLength(0); // free syncs every 24h
    set(hours(25), hours(25));
    expect(dueUsers(t.db)).toHaveLength(1);
    set(hours(25), hours(0.1));
    expect(dueUsers(t.db)).toHaveLength(0); // just tried and failed
    t.db.prepare(`UPDATE users SET plan = 'pro' WHERE id = ?`).run(t.userId);
    set(hours(7), hours(7));
    expect(dueUsers(t.db)).toHaveLength(1); // pro syncs every 6h
  });

  it('reports accounts whose sync is running late', async () => {
    const t = setup(repos());
    const hours = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
    const set = (synced: string | null) =>
      t.db.prepare('UPDATE users SET last_sync_at = ?, last_sync_started_at = ? WHERE id = ?').run(synced, synced, t.userId);

    set(null); // never synced: signing in starts that sync, the schedule is not late
    expect(overdue(dueUsers(t.db)).count).toBe(0);
    set(hours(24.5)); // due, and picked up within the hour
    expect(overdue(dueUsers(t.db)).count).toBe(0);
    set(hours(30));
    const behind = overdue(dueUsers(t.db));
    expect(behind.count).toBe(1);
    expect(behind.worstHours).toBeCloseTo(6, 1);
  });

  it("keeps a repository shared while another admin's plan includes sharing", async () => {
    const t = setup(repos());
    await t.sync();
    const now = new Date().toISOString();
    const bob = t.db.prepare(`INSERT INTO users (github_id, login, plan, created_at) VALUES (2, 'bob', 'pro', ?) RETURNING *`).get(now) as any;
    t.db.prepare(`INSERT INTO user_repos (user_id, repo_id, relation, can_push, can_admin, added_at) VALUES (?, 1, 'collaborator', 1, 1, ?)`).run(bob.id, now);
    t.db.prepare('UPDATE repos SET share_enabled = 1 WHERE id IN (1, 2)').run();
    const shared = () => (t.db.prepare('SELECT id FROM repos WHERE share_enabled = 1 ORDER BY id').all() as Array<{ id: number }>).map((r) => r.id);

    await t.sync(); // alice is on the free plan; repo 2 has no other admin
    expect(shared()).toEqual([1]);

    t.db.prepare(`UPDATE users SET plan = 'free' WHERE id = ?`).run(bob.id);
    enforceLimits(t.db, { ...bob, plan: 'free' });
    expect(shared()).toEqual([]);
  });
});
