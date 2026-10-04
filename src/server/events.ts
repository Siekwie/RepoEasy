import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { EventKind } from '../shared/api.ts';
import { config, effectivePlan, planLimits } from './config.ts';
import { addDays, dayOf, nowIso, type DB, type UserRow } from './db.ts';
import { userSettings } from './sync.ts';

export interface NewEvent {
  kind: EventKind;
  repoId: number | null;
  title: string;
  detail?: string | null;
  url?: string | null;
  /** The same key is only ever recorded once per user. */
  dedupeKey: string;
}

export function recordEvent(db: DB, userId: number, e: NewEvent): boolean {
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO events (user_id, repo_id, kind, title, detail, url, dedupe_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(userId, e.repoId, e.kind, e.title, e.detail ?? null, e.url ?? null, e.dedupeKey, nowIso());
  return result.changes === 1;
}

const MILESTONES = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000];

/** Highest milestone crossed going from `before` to `after`, if any. */
export function crossedMilestone(before: number, after: number): number | null {
  for (let i = MILESTONES.length - 1; i >= 0; i--) {
    const m = MILESTONES[i]!;
    if (before < m && after >= m) return m;
  }
  return null;
}

interface LinkedRepo {
  id: number;
  full_name: string;
  html_url: string;
  relation: string;
  can_push: number;
  tracked: number;
  added_at: string;
  latest_release_tag: string | null;
  latest_release_at: string | null;
}

/** Derives feed events for one user from the archived data. Safe to run repeatedly. */
export function detectEvents(db: DB, userId: number): void {
  const today = dayOf();
  const yesterday = addDays(today, -1);
  const repos = db
    .prepare(
      `SELECT r.id, r.full_name, r.html_url, r.latest_release_tag, r.latest_release_at,
              ur.relation, ur.can_push, ur.tracked, ur.added_at
       FROM user_repos ur JOIN repos r ON r.id = ur.repo_id
       WHERE ur.user_id = ? AND ur.gone = 0`,
    )
    .all(userId) as LinkedRepo[];

  const latestTwo = db.prepare(
    'SELECT day, stars, forks FROM metrics_daily WHERE repo_id = ? AND stars IS NOT NULL ORDER BY day DESC LIMIT 2',
  );
  const trafficWindow = db.prepare('SELECT day, views FROM traffic_daily WHERE repo_id = ? AND day BETWEEN ? AND ?');
  const firstTraffic = db.prepare('SELECT MIN(day) d FROM traffic_daily WHERE repo_id = ?');
  const newReferrers = db.prepare(
    `SELECT s.referrer, s.count FROM referrers_snap s
     WHERE s.repo_id = ? AND s.day = ? AND s.count >= 3
       AND NOT EXISTS (SELECT 1 FROM referrers_snap o WHERE o.repo_id = s.repo_id AND o.day < s.day AND o.referrer = s.referrer)`,
  );

  db.transaction(() => {
    for (const repo of repos) {
      const [now, before] = latestTwo.all(repo.id) as Array<{ day: string; stars: number; forks: number | null }>;
      if (now && before && now.day === today) {
        const stars = crossedMilestone(before.stars, now.stars);
        if (stars) {
          recordEvent(db, userId, {
            kind: 'star-milestone',
            repoId: repo.id,
            title: `${repo.full_name} reached ${stars.toLocaleString('en-US')} stars`,
            detail: `Now at ${now.stars.toLocaleString('en-US')}.`,
            url: repo.html_url,
            dedupeKey: `stars:${repo.id}:${stars}`,
          });
        }
        const forks = crossedMilestone(before.forks ?? 0, now.forks ?? 0);
        if (forks) {
          recordEvent(db, userId, {
            kind: 'fork-milestone',
            repoId: repo.id,
            title: `${repo.full_name} reached ${forks.toLocaleString('en-US')} forks`,
            url: repo.html_url,
            dedupeKey: `forks:${repo.id}:${forks}`,
          });
        }
      }

      if (repo.latest_release_tag && repo.latest_release_at && repo.latest_release_at > repo.added_at) {
        recordEvent(db, userId, {
          kind: 'new-release',
          repoId: repo.id,
          title: `${repo.full_name} released ${repo.latest_release_tag}`,
          url: `${repo.html_url}/releases/tag/${encodeURIComponent(repo.latest_release_tag)}`,
          dedupeKey: `release:${repo.id}:${repo.latest_release_tag}`,
        });
      }

      if (!repo.can_push || !repo.tracked || repo.relation === 'followed') continue;

      // Spike: yesterday (the latest complete day) against the 14 days before it.
      const first = (firstTraffic.get(repo.id) as { d: string | null }).d;
      if (first && first <= addDays(yesterday, -7)) {
        const rows = trafficWindow.all(repo.id, addDays(yesterday, -14), yesterday) as Array<{ day: string; views: number }>;
        const peak = rows.find((r) => r.day === yesterday)?.views ?? 0;
        const average = rows.filter((r) => r.day !== yesterday).reduce((sum, r) => sum + r.views, 0) / 14;
        if (peak >= 30 && peak >= average * 3) {
          recordEvent(db, userId, {
            kind: 'traffic-spike',
            repoId: repo.id,
            title: `Traffic spike on ${repo.full_name}`,
            detail: `${peak.toLocaleString('en-US')} views on ${yesterday}, ${average < 1 ? 'up from almost none' : `${(peak / average).toFixed(1)}x the 14-day average`}.`,
            url: `${repo.html_url}/graphs/traffic`,
            dedupeKey: `spike:${repo.id}:${yesterday}`,
          });
        }
      }

      if (dayOf(repo.added_at) < today) {
        for (const ref of newReferrers.all(repo.id, today) as Array<{ referrer: string; count: number }>) {
          recordEvent(db, userId, {
            kind: 'referrer-new',
            repoId: repo.id,
            title: `New referrer for ${repo.full_name}: ${ref.referrer}`,
            detail: `${ref.count.toLocaleString('en-US')} views in the last 14 days.`,
            url: `${repo.html_url}/graphs/traffic`,
            dedupeKey: `referrer:${repo.id}:${ref.referrer}`,
          });
        }
      }
    }
  })();
}

function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80');
}

/**
 * Checks a user-supplied webhook URL. On a hosted instance the target must be
 * public https so the server cannot be pointed at its own network.
 */
export async function checkWebhookUrl(raw: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'Not a valid URL.';
  }
  if (!config.billing.enabled) {
    return url.protocol === 'https:' || url.protocol === 'http:' ? null : 'Webhook URL must be http(s).';
  }
  if (url.protocol !== 'https:') return 'Webhook URL must use https.';
  try {
    const addresses = isIP(url.hostname) ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true });
    if (addresses.some((a) => isPrivateAddress(a.address))) return 'Webhook URL must point to a public host.';
  } catch {
    return 'Webhook host could not be resolved.';
  }
  return null;
}

const NOTIFY: Partial<Record<EventKind, 'notifyMilestones' | 'notifySpikes' | 'notifyReleases'>> = {
  'star-milestone': 'notifyMilestones',
  'fork-milestone': 'notifyMilestones',
  'traffic-spike': 'notifySpikes',
  'referrer-new': 'notifySpikes',
  'new-release': 'notifyReleases',
};

/** Posts the events recorded after event `afterId` to the user's webhook, if they have one. */
export async function deliverEvents(db: DB, user: UserRow, afterId: number, fetchFn: typeof fetch = fetch): Promise<void> {
  const settings = userSettings(user);
  if (!settings.webhookUrl || !planLimits(effectivePlan(user)).webhooks) return;
  const events = (
    db
      .prepare('SELECT kind, title, detail, url, created_at FROM events WHERE user_id = ? AND id > ? ORDER BY id')
      .all(user.id, afterId) as Array<{ kind: EventKind; title: string; detail: string | null; url: string | null; created_at: string }>
  ).filter((e) => {
    const setting = NOTIFY[e.kind];
    return setting && settings[setting];
  });
  if (!events.length) return;
  if (await checkWebhookUrl(settings.webhookUrl)) return;

  const text = events.map((e) => `${e.title}${e.detail ? ` (${e.detail})` : ''}${e.url ? ` ${e.url}` : ''}`).join('\n').slice(0, 1900);
  const host = new URL(settings.webhookUrl).hostname;
  const body = host.endsWith('discord.com') || host.endsWith('discordapp.com')
    ? { username: 'RepoEasy', content: text }
    : host.endsWith('slack.com')
      ? { text }
      : { text, events };
  try {
    await fetchFn(settings.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'RepoEasy' },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    console.warn(`[webhook] delivery for user ${user.id} failed: ${err instanceof Error ? err.message : err}`);
  }
}
