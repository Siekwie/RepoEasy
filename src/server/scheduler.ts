import { config, effectivePlan, planLimits } from './config.ts';
import { nowIso, type DB, type UserRow } from './db.ts';
import { seedDemo } from './demo.ts';
import { syncUser } from './sync.ts';

/** A failed sync is not retried sooner than this, so a rate-limited account is left alone. */
const RETRY_MINUTES = 30;

export function dueUsers(db: DB, now = Date.now()): UserRow[] {
  const users = db
    .prepare('SELECT * FROM users WHERE is_demo = 0 AND token_enc IS NOT NULL AND token_invalid = 0 ORDER BY last_sync_at')
    .all() as UserRow[];
  return users.filter((user) => {
    const interval = planLimits(effectivePlan(user)).syncIntervalHours * 3_600_000;
    const synced = user.last_sync_at ? Date.parse(user.last_sync_at) : 0;
    const started = user.last_sync_started_at ? Date.parse(user.last_sync_started_at) : 0;
    return now - synced >= interval && now - started >= RETRY_MINUTES * 60_000;
  });
}

/**
 * Syncs accounts one after another on a timer. One account at a time keeps
 * memory and GitHub concurrency flat no matter how many accounts exist.
 */
export function startScheduler(db: DB): () => void {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(nowIso());
      if (config.demo) seedDemo(db); // keeps the sample data ending "today"
      for (const user of dueUsers(db)) await syncUser(db, user.id);
    } catch (err) {
      console.error('[scheduler]', err);
    } finally {
      busy = false;
    }
  };
  const first = setTimeout(tick, 5_000);
  const timer = setInterval(tick, config.sync.tickSeconds * 1000);
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
