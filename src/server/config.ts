import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Plan, PlanLimits } from '../shared/api.ts';

try {
  process.loadEnvFile('.env');
} catch {
  // no .env file: configuration comes from the real environment
}

const env = process.env;
const str = (key: string) => env[key]?.trim() || null;
const int = (key: string, fallback: number) => {
  const n = Number(env[key]);
  return Number.isFinite(n) && env[key] !== undefined && env[key] !== '' ? n : fallback;
};
const flag = (key: string) => ['1', 'true', 'yes', 'on'].includes((env[key] ?? '').toLowerCase());
/** A limit of 0 or below in the environment means unlimited. */
const limit = (key: string, fallback: number) => {
  const n = int(key, fallback);
  return n > 0 ? n : null;
};

export const VERSION = '0.1.0';

const port = int('PORT', 8787);
const dataDir = resolve(str('DATA_DIR') ?? './data');
const stripeSecretKey = str('STRIPE_SECRET_KEY');
const baseUrl = (str('BASE_URL') ?? `http://localhost:${port}`).replace(/\/+$/, '');
const local = ['localhost', '127.0.0.1'].includes(new URL(baseUrl).hostname);

export const config = {
  port,
  host: str('HOST') ?? '127.0.0.1',
  baseUrl,
  /**
   * Origins allowed to send state-changing requests besides the server's own host.
   * A local instance also trusts the Vite dev server, whose proxy rewrites Host.
   */
  allowedOrigins: [
    new URL(baseUrl).origin,
    ...(str('ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    ...(local ? ['http://localhost:5173', 'http://127.0.0.1:5173'] : []),
  ],
  dataDir,
  dbPath: str('DB_PATH') ?? join(dataDir, 'repoeasy.db'),
  webDir: resolve(str('WEB_DIR') ?? './dist/web'),

  github: {
    clientId: str('GITHUB_CLIENT_ID'),
    clientSecret: str('GITHUB_CLIENT_SECRET'),
    /** Scopes requested from a classic OAuth App. Ignored by GitHub Apps (they use app permissions). */
    scopes: str('GITHUB_SCOPES') ?? 'read:user repo',
    /** URL slug of the GitHub App, when sign-in runs through one instead of an OAuth App. */
    appSlug: str('GITHUB_APP_SLUG'),
    apiUrl: (str('GITHUB_API_URL') ?? 'https://api.github.com').replace(/\/+$/, ''),
    webUrl: (str('GITHUB_WEB_URL') ?? 'https://github.com').replace(/\/+$/, ''),
  },

  /** Single-user self-host mode: this token's account is the only account. */
  localToken: str('GITHUB_TOKEN'),
  appPassword: str('APP_PASSWORD'),
  demo: flag('DEMO'),
  /** Comma-separated GitHub logins that always get every feature on a hosted instance. */
  adminLogins: (str('ADMIN_LOGINS') ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),

  sync: {
    /** Disable the background scheduler (tests, one-off scripts). */
    disabled: flag('SYNC_DISABLED'),
    tickSeconds: int('SYNC_TICK_SECONDS', 300),
    /** Minimum minutes between manual "Sync now" runs. */
    manualCooldownMinutes: int('SYNC_MANUAL_COOLDOWN_MINUTES', 10),
    /** Initial commit history depth per repo (pages of 100). */
    commitPages: int('SYNC_COMMIT_PAGES', 3),
    /** Star-history pages (30 weeks each) fetched per repo per sync while backfilling. */
    starPages: int('SYNC_STAR_PAGES', 20),
    concurrency: int('SYNC_CONCURRENCY', 4),
  },

  billing: {
    enabled: Boolean(stripeSecretKey),
    stripeSecretKey,
    stripeWebhookSecret: str('STRIPE_WEBHOOK_SECRET'),
    priceMonthly: str('STRIPE_PRICE_MONTHLY'),
    priceYearly: str('STRIPE_PRICE_YEARLY'),
    displayMonthly: str('PRICE_DISPLAY_MONTHLY') ?? '$3',
    displayYearly: str('PRICE_DISPLAY_YEARLY') ?? '$29',
  },
};

const limits: Record<Plan, PlanLimits> = {
  free: {
    trackedRepos: limit('FREE_TRACKED_REPOS', 3),
    followedRepos: limit('FREE_FOLLOWED_REPOS', 10),
    syncIntervalHours: int('FREE_SYNC_INTERVAL_HOURS', 24),
    apiTokens: false,
    webhooks: false,
    sharePages: false,
  },
  pro: {
    trackedRepos: null,
    followedRepos: limit('PRO_FOLLOWED_REPOS', 100),
    syncIntervalHours: int('PRO_SYNC_INTERVAL_HOURS', 6),
    apiTokens: true,
    webhooks: true,
    sharePages: true,
  },
  selfhost: {
    trackedRepos: null,
    followedRepos: null,
    syncIntervalHours: int('SYNC_INTERVAL_HOURS', 6),
    apiTokens: true,
    webhooks: true,
    sharePages: true,
  },
};

export function planLimits(plan: Plan): PlanLimits {
  return limits[plan];
}

/**
 * The plan a user effectively has. Without billing configured every account is
 * `selfhost` (everything unlocked); admins are unlocked on hosted instances too.
 */
export function effectivePlan(user: { login: string; plan: string; plan_expires_at: string | null }): Plan {
  if (!config.billing.enabled) return 'selfhost';
  if (config.adminLogins.includes(user.login.toLowerCase())) return 'selfhost';
  // plan_expires_at is the paid-through date; a few days of grace cover late renewal webhooks
  const grace = 3 * 86_400_000;
  if (user.plan === 'pro' && (!user.plan_expires_at || Date.parse(user.plan_expires_at) + grace > Date.now())) {
    return 'pro';
  }
  return 'free';
}

/**
 * Secret used to encrypt GitHub tokens at rest and to sign OAuth state.
 * Taken from APP_SECRET, else generated once and kept next to the database.
 */
export function appSecret(): string {
  const fromEnv = str('APP_SECRET');
  if (fromEnv) return fromEnv;
  const file = join(config.dataDir, 'secret.key');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  mkdirSync(config.dataDir, { recursive: true });
  const secret = randomBytes(32).toString('hex');
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}
