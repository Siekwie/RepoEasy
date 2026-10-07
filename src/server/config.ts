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
const list = (key: string, separator: string) => (str(key) ?? '').split(separator).map((s) => s.trim()).filter(Boolean);

export const VERSION = '0.1.0';

const port = int('PORT', 8787);
const dataDir = resolve(str('DATA_DIR') ?? './data');
const stripeSecretKey = str('STRIPE_SECRET_KEY');
const baseUrl = (str('BASE_URL') ?? `http://localhost:${port}`).replace(/\/+$/, '');
const LOOPBACK = ['localhost', '127.0.0.1', '[::1]', '::1'];
const local = LOOPBACK.includes(new URL(baseUrl).hostname);
const host = str('HOST') ?? '127.0.0.1';
const extraOrigins = (str('ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const githubClientId = str('GITHUB_CLIENT_ID');
/** TRUST_PROXY is the number of reverse proxies in front of the server; "true" means one. */
const trustProxy = flag('TRUST_PROXY') ? 1 : Math.max(0, Math.floor(int('TRUST_PROXY', 0)));
/** More than one person can have an account here: user input gets hosted-service treatment. */
const multiUser = Boolean(githubClientId) || Boolean(stripeSecretKey);

export const config = {
  port,
  host,
  baseUrl,
  multiUser,
  /**
   * How many reverse proxies sit in front of the server. Each one appends the address it saw to
   * X-Forwarded-For, so with n proxies the nth entry from the right is the real client and
   * everything left of it is whatever the client chose to send.
   */
  trustProxy,
  /**
   * Hostnames this server answers API and auth requests for. Anything else is
   * refused, which stops DNS-rebinding pages from talking to a local instance.
   */
  allowedHosts: [...new Set([new URL(baseUrl).hostname, ...extraOrigins.map((o) => new URL(o).hostname), ...LOOPBACK])],
  /**
   * Origins allowed to send state-changing requests besides the server's own host.
   * A local instance also trusts the Vite dev server, whose proxy rewrites Host.
   */
  allowedOrigins: [
    new URL(baseUrl).origin,
    ...extraOrigins,
    ...(local ? ['http://localhost:5173', 'http://127.0.0.1:5173'] : []),
  ],
  dataDir,
  dbPath: str('DB_PATH') ?? join(dataDir, 'repoeasy.db'),
  webDir: resolve(str('WEB_DIR') ?? './dist/web'),

  github: {
    clientId: githubClientId,
    clientSecret: str('GITHUB_CLIENT_SECRET'),
    /** Scopes requested from a classic OAuth App. Ignored by GitHub Apps (they use app permissions). */
    scopes: str('GITHUB_SCOPES') ?? 'read:user repo',
    /** URL slug of the GitHub App, when sign-in runs through one instead of an OAuth App. */
    appSlug: str('GITHUB_APP_SLUG'),
    apiUrl: (str('GITHUB_API_URL') ?? 'https://api.github.com').replace(/\/+$/, ''),
    webUrl: (str('GITHUB_WEB_URL') ?? 'https://github.com').replace(/\/+$/, ''),
  },

  codeberg: {
    apiUrl: (str('CODEBERG_API_URL') ?? 'https://codeberg.org/api/v1').replace(/\/+$/, ''),
    /** Optional. Public repositories are read without one; a token identifies this instance to Codeberg. */
    token: str('CODEBERG_TOKEN'),
  },

  /** Single-user self-host mode: this token's account is the only account. Ignored on a multi-user instance. */
  localToken: multiUser ? null : str('GITHUB_TOKEN'),
  appPassword: str('APP_PASSWORD'),
  /** Reachable beyond this machine: the local sign-in then insists on APP_PASSWORD. */
  exposed: !local || !LOOPBACK.includes(host),
  demo: flag('DEMO'),
  /** Comma-separated GitHub logins or numeric user ids that always get every feature on a hosted instance. */
  adminLogins: list('ADMIN_LOGINS', ',').map((s) => s.toLowerCase()),
  /** The owner's admin interface (admin-web.ts): a listener of its own with no login, so it stays on loopback. */
  admin: {
    host: str('ADMIN_HOST') ?? '127.0.0.1',
    port: int('ADMIN_PORT', 8793),
    webDir: resolve(str('ADMIN_WEB_DIR') ?? './dist/admin'),
  },

  /**
   * Who runs this instance. With a name and an address the imprint, privacy and terms pages are
   * shown; an instance run for one person leaves these unset.
   */
  operator: {
    name: str('OPERATOR_NAME'),
    /** Postal address, lines separated by ";". */
    address: list('OPERATOR_ADDRESS', ';'),
    email: str('OPERATOR_EMAIL'),
    /** Hosting provider named on the privacy page, e.g. "Hetzner Online GmbH, Germany". */
    hosting: str('OPERATOR_HOSTING'),
    /** Footer links as "Label=https://...", comma-separated. */
    links: list('OPERATOR_LINKS', ',').flatMap((entry) => {
      const at = entry.indexOf('=');
      const label = entry.slice(0, at).trim();
      const url = entry.slice(at + 1).trim();
      return at > 0 && label && /^https?:\/\//i.test(url) ? [{ label, url }] : [];
    }),
  },

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
    /** Accounts synced at the same time by the scheduler. */
    accounts: Math.max(1, int('SYNC_ACCOUNTS', 3)),
  },

  backup: {
    dir: resolve(str('BACKUP_DIR') ?? join(dataDir, 'backups')),
    /** Hours between database snapshots; 0 switches them off. */
    intervalHours: int('BACKUP_INTERVAL_HOURS', 24),
    /** Snapshots kept; older ones are deleted. */
    keep: Math.max(1, int('BACKUP_KEEP', 7)),
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

/** Listed in ADMIN_LOGINS: every feature on a hosted instance. */
export function isAdmin(user: { login: string; github_id: number | null }): boolean {
  // ids are safer than logins, which can be renamed and re-registered by someone else
  return config.adminLogins.includes(user.login.toLowerCase()) || (user.github_id !== null && config.adminLogins.includes(String(user.github_id)));
}

/**
 * The plan a user effectively has. Without billing configured every account is
 * `selfhost` (everything unlocked); admins are unlocked on hosted instances too.
 */
export function effectivePlan(user: { login: string; github_id: number | null; plan: string; plan_expires_at: string | null }): Plan {
  if (!config.billing.enabled) return 'selfhost';
  if (isAdmin(user)) return 'selfhost';
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
