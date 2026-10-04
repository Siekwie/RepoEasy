import { beforeAll, describe, expect, it } from 'vitest';

// Billing is switched on by configuration, which is read at import time,
// so the modules are loaded only after the environment is prepared.
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

let setup: typeof import('./helpers.ts').setup;
let applyStripeEvent: typeof import('../src/server/billing.ts').applyStripeEvent;
let dueUsers: typeof import('../src/server/scheduler.ts').dueUsers;

beforeAll(async () => {
  ({ setup } = await import('./helpers.ts'));
  ({ applyStripeEvent } = await import('../src/server/billing.ts'));
  ({ dueUsers } = await import('../src/server/scheduler.ts'));
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
    applyStripeEvent(t.db, { type: 'checkout.session.completed', data: { object: { client_reference_id: String(t.userId), customer: 'cus_1', subscription: 'sub_1' } } });
    applyStripeEvent(t.db, subscription('customer.subscription.updated', 'active'));
    me = (await t.api('GET', '/api/me')).data;
    expect(me.plan).toBe('pro');
    expect(me.billing.hasSubscription).toBe(true);
    expect((await t.api('PATCH', `/api/repos/${untracked.id}`, { tracked: true })).data.tracked).toBe(true);
    expect((await t.api('POST', '/api/repos/follow', { fullName: 'vendor/pub10' })).status).toBe(201);
    expect((await t.api('POST', '/api/tokens', { name: 'x' })).status).toBe(201);

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
});
