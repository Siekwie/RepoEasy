import { createHmac } from 'node:crypto';
import { config } from './config.ts';
import { safeEqual } from './crypto.ts';
import type { DB, UserRow } from './db.ts';
import { enforceLimits } from './sync.ts';

// Stripe is called over plain HTTPS: three endpoints do not justify the SDK.

type Form = Record<string, string | undefined>;

async function stripe<T>(path: string, form: Form, fetchFn: typeof fetch = fetch): Promise<T> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(form)) if (v !== undefined) params.set(k, v);
  const res = await fetchFn(`https://api.stripe.com/v1${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.billing.stripeSecretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(data.error?.message ?? `Stripe responded ${res.status}`);
  return data;
}

export async function checkoutUrl(user: UserRow, interval: 'month' | 'year', fetchFn?: typeof fetch): Promise<string> {
  const price = interval === 'year' ? config.billing.priceYearly : config.billing.priceMonthly;
  if (!price) throw new Error(`No Stripe price configured for the ${interval}ly plan.`);
  const session = await stripe<{ url: string }>(
    '/checkout/sessions',
    {
      mode: 'subscription',
      'line_items[0][price]': price,
      'line_items[0][quantity]': '1',
      success_url: `${config.baseUrl}/settings?upgraded=1`,
      cancel_url: `${config.baseUrl}/settings`,
      client_reference_id: String(user.id),
      customer: user.stripe_customer_id ?? undefined,
      customer_email: user.stripe_customer_id ? undefined : (user.email ?? undefined),
      allow_promotion_codes: 'true',
      'subscription_data[metadata][user_id]': String(user.id),
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
  metadata?: { user_id?: string };
}

interface StripeEvent {
  type: string;
  data: { object: Record<string, unknown> };
}

/** Applies a verified Stripe webhook event to the matching account. */
export function applyStripeEvent(db: DB, event: StripeEvent): void {
  const object = event.data.object;

  if (event.type === 'checkout.session.completed') {
    const userId = Number(object.client_reference_id);
    if (!userId) return;
    db.prepare(`UPDATE users SET plan = 'pro', plan_expires_at = NULL, stripe_customer_id = ?, stripe_subscription_id = ? WHERE id = ?`).run(
      (object.customer as string) ?? null,
      (object.subscription as string) ?? null,
      userId,
    );
    return;
  }

  if (event.type.startsWith('customer.subscription.')) {
    const sub = object as unknown as StripeSubscription;
    const user = db
      .prepare('SELECT * FROM users WHERE stripe_customer_id = ? OR id = ?')
      .get(sub.customer, Number(sub.metadata?.user_id) || -1) as UserRow | undefined;
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
    } else {
      db.prepare(`UPDATE users SET plan = 'free', plan_expires_at = NULL, stripe_subscription_id = NULL WHERE id = ?`).run(user.id);
      enforceLimits(db, db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as UserRow);
    }
  }
}
