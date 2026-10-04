import { config } from './config.ts';
import { dayOf, type DB } from './db.ts';

export type VisitKind = 'landing' | 'signin' | 'demo' | 'signup';

/** New sources accepted per day; more than this is someone inventing them, and lands in "other". */
const MAX_SOURCES_PER_DAY = 200;

/**
 * Where a visitor came from: a `?ref=` tag on the link wins, then the site that linked here.
 * '' is a direct visit. Only the tag or the hostname is kept, never the full address.
 */
export function visitSource(ref: unknown, referrer: unknown): string {
  const tag = typeof ref === 'string' ? ref.trim().toLowerCase() : '';
  if (/^[a-z0-9][a-z0-9._-]{0,59}$/.test(tag)) return tag;
  if (typeof referrer !== 'string' || !referrer) return '';
  try {
    const host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, '');
    return host && host.length <= 60 && host !== new URL(config.baseUrl).hostname ? host : '';
  } catch {
    return '';
  }
}

export function recordVisit(db: DB, kind: VisitKind, source: string): void {
  const day = dayOf();
  let src = source;
  if (src && !db.prepare('SELECT 1 FROM visits WHERE day = ? AND source = ? LIMIT 1').get(day, src)) {
    const { n } = db.prepare('SELECT COUNT(DISTINCT source) n FROM visits WHERE day = ?').get(day) as { n: number };
    if (n >= MAX_SOURCES_PER_DAY) src = 'other';
  }
  db.prepare(
    'INSERT INTO visits (day, kind, source, count) VALUES (?, ?, ?, 1) ON CONFLICT(day, kind, source) DO UPDATE SET count = count + 1',
  ).run(day, kind, src);
}

/** Landing-page hits one address may add per hour, so a loop cannot inflate the numbers. Held in memory only. */
const HITS_PER_HOUR = 20;
const recentHits = new Map<string, number[]>();

export function hitAllowed(address: string, now = Date.now()): boolean {
  const recent = (recentHits.get(address) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= HITS_PER_HOUR) return false;
  if (recentHits.size > 10_000) recentHits.clear();
  recentHits.set(address, [...recent, now]);
  return true;
}

// The source of a sign-in travels from /auth/github to the callback under the OAuth state, in
// memory: nothing extra is stored in the browser.
const pendingSources = new Map<string, { source: string; at: number }>();

export function rememberSource(state: string, source: string, now = Date.now()): void {
  if (pendingSources.size > 1000) {
    for (const [key, entry] of pendingSources) if (now - entry.at > 600_000) pendingSources.delete(key);
    if (pendingSources.size > 5000) pendingSources.clear();
  }
  pendingSources.set(state, { source, at: now });
}

export function takeSource(state: string): string {
  const entry = pendingSources.get(state);
  pendingSources.delete(state);
  return entry?.source ?? '';
}
