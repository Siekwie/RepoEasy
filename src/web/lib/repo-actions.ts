import { useCallback, useState } from 'react';
import type { RepoPatch, RepoSummary } from '../../shared/api.ts';
import { useApp } from '../context.tsx';
import { api } from './api.ts';

/**
 * PATCH a repository for the signed-in user. `apply` receives the server's updated row (the caller
 * decides where it lives: a list, a detail view). Resolves to that row, or null after reporting a failure.
 * `busy` holds the ids with a save in flight.
 */
export function usePatchRepo(apply: (u: RepoSummary) => void) {
  const { fail, reloadMe } = useApp();
  const [busy, setBusy] = useState<ReadonlySet<number>>(new Set());

  const patch = useCallback(
    async (id: number, p: RepoPatch): Promise<RepoSummary | null> => {
      setBusy((b) => new Set(b).add(id));
      try {
        const u = await api.patchRepo(id, p);
        apply(u);
        if (p.tracked !== undefined) void reloadMe();
        return u;
      } catch (e) {
        fail(e);
        return null;
      } finally {
        setBusy((b) => {
          const n = new Set(b);
          n.delete(id);
          return n;
        });
      }
    },
    [fail, reloadMe, apply],
  );

  return { patch, busy };
}
