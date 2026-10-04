import { describe, expect, it } from 'vitest';
import type { SyncStatus } from '../../src/shared/api.ts';
import { filenameFromDisposition } from '../../src/web/lib/download.ts';
import { syncFinished } from '../../src/web/lib/sync.ts';

const status = (over: Partial<SyncStatus> = {}): SyncStatus => ({
  running: false,
  step: null,
  lastSyncAt: '2026-10-04T08:00:00Z',
  lastError: null,
  nextSyncAt: null,
  rateLimitRemaining: null,
  ...over,
});

describe('syncFinished', () => {
  it('is true when a sync we saw running has stopped', () => {
    expect(syncFinished(status({ running: true }), status())).toBe(true);
  });

  it('is true when a whole sync happened between two polls (lastSyncAt moved on)', () => {
    expect(syncFinished(status(), status({ lastSyncAt: '2026-10-04T14:00:00Z' }))).toBe(true);
    expect(syncFinished(status({ lastSyncAt: null }), status())).toBe(true);
  });

  it('is false while a sync is still running, or when nothing changed', () => {
    expect(syncFinished(status(), status({ running: true }))).toBe(false);
    expect(syncFinished(status({ running: true }), status({ running: true }))).toBe(false);
    expect(syncFinished(status(), status())).toBe(false);
  });

  it('never fires on the first look', () => {
    expect(syncFinished(null, status())).toBe(false);
  });

  it('a failed sync that ends still counts: the server state may have changed', () => {
    expect(syncFinished(status({ running: true }), status({ lastError: 'rate limited' }))).toBe(true);
  });
});

describe('filenameFromDisposition', () => {
  it('reads a quoted filename', () => {
    expect(filenameFromDisposition('attachment; filename="owner-repo-traffic.csv"', 'x.csv')).toBe('owner-repo-traffic.csv');
  });

  it('reads an unquoted filename', () => {
    expect(filenameFromDisposition('attachment; filename=export.json', 'x.json')).toBe('export.json');
  });

  it('prefers the RFC 6266 UTF-8 form and decodes it', () => {
    expect(filenameFromDisposition("attachment; filename=\"fallback.csv\"; filename*=UTF-8''r%C3%A9sum%C3%A9.csv", 'x.csv')).toBe('résumé.csv');
  });

  it('unescapes quoted pairs', () => {
    expect(filenameFromDisposition('attachment; filename="a\\"b.csv"', 'x.csv')).toBe('a"b.csv');
  });

  it('falls back when the header is missing or has no name', () => {
    expect(filenameFromDisposition(null, 'fallback.csv')).toBe('fallback.csv');
    expect(filenameFromDisposition('attachment', 'fallback.csv')).toBe('fallback.csv');
    expect(filenameFromDisposition('attachment; filename=""', 'fallback.csv')).toBe('fallback.csv');
  });

  it('survives a malformed percent escape by using the plain name', () => {
    expect(filenameFromDisposition("attachment; filename=\"ok.csv\"; filename*=UTF-8''%E0%A4%A", 'x.csv')).toBe('ok.csv');
  });

  it('never lets the header pick a directory', () => {
    expect(filenameFromDisposition('attachment; filename="../../etc/passwd"', 'x.csv')).toBe('passwd');
    expect(filenameFromDisposition('attachment; filename="C:\\\\temp\\\\a.csv"', 'x.csv')).toBe('a.csv');
  });
});
