import type { SyncStatus } from '../../shared/api.ts';

/**
 * True when `next` shows a sync that finished since `prev`: one we watched running stopped, or the
 * server ran one in between polls (its `lastSyncAt` moved on). Pages should refetch when this holds.
 */
export function syncFinished(prev: SyncStatus | null, next: SyncStatus): boolean {
  if (!prev || next.running) return false;
  return prev.running || prev.lastSyncAt !== next.lastSyncAt;
}
