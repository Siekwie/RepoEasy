import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { DB } from './db.ts';

const NAME = /^repoeasy-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.db$/;

/** Finished snapshots in `dir`, newest first. */
export function listBackups(dir: string): Array<{ file: string; takenAt: number }> {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return []; // no backup has been written yet
  }
  const found: Array<{ file: string; takenAt: number }> = [];
  for (const file of names) {
    const m = NAME.exec(file);
    if (m) found.push({ file, takenAt: Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!) });
  }
  return found.sort((a, b) => b.takenAt - a.takenAt);
}

export function backupDue(dir: string, intervalHours: number, now = Date.now()): boolean {
  if (intervalHours <= 0) return false;
  const newest = listBackups(dir)[0];
  return !newest || now - newest.takenAt >= intervalHours * 3_600_000;
}

/**
 * Writes a consistent copy of the live database into `dir` and deletes all but the newest
 * `keep` snapshots. A snapshot is a complete SQLite file: restoring is copying it back.
 */
export async function backupDb(db: DB, dir: string, keep: number, now = new Date()): Promise<string> {
  mkdirSync(dir, { recursive: true });
  // a crash mid-backup leaves a partial file behind; it is never counted as a snapshot
  for (const name of readdirSync(dir)) if (name.endsWith('.partial')) rmSync(join(dir, name), { force: true });
  const file = join(dir, `repoeasy-${now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}.db`);
  await db.backup(`${file}.partial`);
  renameSync(`${file}.partial`, file);
  for (const old of listBackups(dir).slice(keep)) rmSync(join(dir, old.file), { force: true });
  return file;
}
