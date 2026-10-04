import { createHmac } from 'node:crypto';
import { config } from './config.ts';
import { safeEqual } from './crypto.ts';
import type { DB, UserRow } from './db.ts';
import { enforceLimits } from './sync.ts';

// Stripe is called over plain HTTPS: three endpoints do not justify the SDK.

type Form = Record<string, string | undefined>;

async function stripe<T>(path: string, form: Form, fetchFn: typeof fetch = fetch, method = 'POST'): Promise<T> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(form)) if (v !== undefined) params.set(k, v);
  const res = await fetchFn(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.billing.stripeSecretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: method === 'POST' ? params : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(data.error?.message ?? `Stripe responded ${res.status}`);
  return data;
}

/**
 * Ties Stripe objects to one account. Row ids alone could be reused after an
 * account is deleted, so the GitHub id has to match as well.
 */
const userRef = (user: Pick<UserRow, 'id' | 'github_id'>) => `${user.id}:${user.github_id}`;

function userByRef(db: DB, ref: unknown): UserRow | undefined {
  const [id, githubId] = String(ref ?? '').split(':').map(Number);
  if (!id || !githubId) return undefined;
  return db.prepare('SELECT * FROM users WHERE id = ? AND github_id = ?').get(id, githubId) as UserRow | undefined;
}

export async function checkoutUrl(user: UserRow, interval: 'month' | 'year', fetchFn?: typeof fetch): Promise<string> {
  if (user.stripe_subscription_id) throw new Error('This account already has a subscription. Use "Manage subscription" to change it.');
  const price = interval === 'year' ? config.billing.priceYearly : config.billing.priceMonthly;
  if (!price) throw new Error(`No Stripe price configured for the ${interval}ly plan.`);
  const session = await stripe<{ url: string }>(
    '/checkout/sessions',
    {
      mode: 'subscription',
      'line_items[0][price]': price,
      'line_items[0][quantity]': '1',
      // the settings page reacts to ?billing=success by refreshing the plan
      success_url: `${config.baseUrl}/settings?billing=success`,
      cancel_url: `${config.baseUrl}/settings?billing=cancelled`,
      client_reference_id: userRef(user),
      customer: user.stripe_customer_id ?? undefined,
      customer_email: user.stripe_customer_id ? undefined : (user.email ?? undefined),
      allow_promotion_codes: 'true',
      'subscription_data[metadata][user_ref]': userRef(user),
    },
    fetchFn,
  );
  return session.url;
}

export async function portalUrl(user: UserRow, fetchFn?: typeof fetch): Promise<string> {
  if (!user.stripe_customer_id) throw new Error('No subscription on this account.');
  const session = await stripe<{ url: string }>(
    '/billing_portal/sessions',
    { customer: user.stripe_customer_id, return_url: `${config.baseUrl}/settings` },
    fetchFn,
  );
  return session.url;
}

/** Ends the subscription right away; used when an account is deleted. */
export async function cancelSubscription(user: UserRow, fetchFn?: typeof fetch): Promise<void> {
  if (!user.stripe_subscription_id) return;
  await stripe(`/subscriptions/${encodeURIComponent(user.stripe_subscription_id)}`, {}, fetchFn, 'DELETE');
}

/** Verifies a `Stripe-Signature` header against the raw request body. */
export function verifyStripeSignature(rawBody: string, header: string, secret: string, toleranceSeconds = 300): boolean {
  const parts = new Map<string, string[]>();
  for (const piece of header.split(',')) {
    const [k, v] = piece.split('=', 2);
    if (k && v) parts.set(k.trim(), [...(parts.get(k.trim()) ?? []), v.trim()]);
  }
  const timestamp = parts.get('t')?.[0];
  if (!timestamp || Math.abs(Date.now() / 1000 - Number(timestamp)) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return (parts.get('v1') ?? []).some((sig) => safeEqual(sig, expected));
}

interface StripeSubscription {
  id: string;
  customer: string;
  status: string;
  current_period_end?: number;
  items?: { data?: Array<{ current_period_end?: number }> };
  metadata?: { user_ref?: string };
}

interface StripeEvent {
  type: string;
  data: { object: Record<string, unknown> };
}

/** Applies a verified Stripe webhook event to the matching account. */
export function applyStripeEvent(db: DB, event: StripeEvent): void {
  const object = event.data.object;

  if (event.type === 'checkout.session.completed') {
    const user = userByRef(db, object.client_reference_id);
    const paid = object.payment_status === 'paid' || object.payment_status === 'no_payment_required';
    if (!user || object.mode !== 'subscription' || !paid) return;
    // Pro for a few days on the strength of the checkout alone; the subscription
    // event that follows (or already arrived) carries the real paid-through date.
    const provisional = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const keep = user.plan === 'pro' && user.plan_expires_at && user.plan_expires_at > provisional;
    db.prepare(`UPDATE users SET plan = 'pro', plan_expires_at = ?, stripe_customer_id = ?, stripe_subscription_id = ? WHERE id = ?`).run(
      keep ? user.plan_expires_at : provisional,
      (object.customer as string) ?? null,
      (object.subscription as string) ?? null,
      user.id,
    );
    return;
  }

  if (event.type.startsWith('customer.subscription.')) {
    const sub = object as unknown as StripeSubscription;
    const user =
      (db.prepare('SELECT * FROM users WHERE stripe_customer_id = ?').get(sub.customer) as UserRow | undefined) ??
      userByRef(db, sub.metadata?.user_ref);
    if (!user) return;
    const active = event.type !== 'customer.subscription.deleted' && ['active', 'trialing', 'past_due'].includes(sub.status);
    const periodEnd = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end;
    if (active) {
      db.prepare(`UPDATE users SET plan = 'pro', plan_expires_at = ?, stripe_customer_id = ?, stripe_subscription_id = ? WHERE id = ?`).run(
        periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
        sub.customer,
        sub.id,
        user.id,
      );
    } else if (!user.stripe_subscription_id || user.stripe_subscription_id === sub.id) {
      // an event about some other, older subscription must not end the current one
      db.prepare(`UPDATE users SET plan = 'free', plan_expires_at = NULL, stripe_subscription_id = NULL WHERE id = ?`).run(user.id);
      enforceLimits(db, db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as UserRow);
    }
  }
}
