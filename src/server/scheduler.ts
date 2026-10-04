import { backupDb, backupDue } from './backup.ts';
import { config, effectivePlan, planLimits } from './config.ts';
import { nowIso, type DB, type UserRow } from './db.ts';
import { seedDemo } from './demo.ts';
import { syncUser } from './sync.ts';

/** A failed sync is not retried sooner than this, so a rate-limited account is left alone. */
const RETRY_MINUTES = 30;
/** How late a sync may start before the log mentions it. */
const OVERDUE_MINUTES = 60;

const intervalMs = (user: UserRow) => planLimits(effectivePlan(user)).syncIntervalHours * 3_600_000;

export function dueUsers(db: DB, now = Date.now()): UserRow[] {
  const users = db
    .prepare('SELECT * FROM users WHERE is_demo = 0 AND token_enc IS NOT NULL AND token_invalid = 0 ORDER BY last_sync_at')
    .all() as UserRow[];
  return users.filter((user) => {
    const synced = user.last_sync_at ? Date.parse(user.last_sync_at) : 0;
    const started = user.last_sync_started_at ? Date.parse(user.last_sync_started_at) : 0;
    return now - synced >= intervalMs(user) && now - started >= RETRY_MINUTES * 60_000;
  });
}

/**
 * Accounts whose sync is late by more than an hour, and the longest delay in hours.
 * A growing number means the scheduler cannot keep up (raise SYNC_ACCOUNTS) or syncs keep failing.
 */
export function overdue(users: UserRow[], now = Date.now()): { count: number; worstHours: number } {
  const late = users
    .filter((user) => user.last_sync_at) // a brand-new account is synced by its sign-in, not by the schedule
    .map((user) => now - Date.parse(user.last_sync_at!) - intervalMs(user))
    .filter((ms) => ms > OVERDUE_MINUTES * 60_000);
  return { count: late.length, worstHours: late.length ? Math.max(...late) / 3_600_000 : 0 };
}

/**
 * Syncs due accounts on a timer, a few at a time. Each account uses its own GitHub token and
 * rate limit, so the small pool only bounds memory and outgoing connections.
 */
export function startScheduler(db: DB): () => void {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(nowIso());
      if (config.demo) seedDemo(db); // keeps the sample data ending "today"
      if (backupDue(config.backup.dir, config.backup.intervalHours)) {
        try {
          console.log(`[backup] wrote ${await backupDb(db, config.backup.dir, config.backup.keep)}`);
        } catch (err) {
          console.error(`[backup] failed: ${err instanceof Error ? err.message : err}`);
        }
      }
      const due = dueUsers(db);
      const behind = overdue(due);
      if (behind.count) {
        console.warn(`[scheduler] ${behind.count} of ${due.length} due accounts are overdue, the longest by ${behind.worstHours.toFixed(1)} h`);
      }
      let next = 0;
      const worker = async () => {
        while (next < due.length) await syncUser(db, due[next++]!.id);
      };
      await Promise.all(Array.from({ length: Math.min(config.sync.accounts, due.length) }, worker));
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
