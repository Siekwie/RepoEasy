/**
 * Pure state for `useFetch`. Every result remembers which deps (the "key") it was fetched for, so data
 * or an error from a previous key is never handed to the page as if it belonged to the current one.
 */
export type Deps = readonly unknown[];

export interface FetchSlot<T> {
  data: T | null;
  /** The key `data` belongs to. */
  dataFor: Deps | null;
  error: Error | null;
  /** The key of the last finished request (success or failure); null until the first one ends. */
  settledFor: Deps | null;
  loading: boolean;
}

export function sameDeps(a: Deps | null, b: Deps): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}

export function initialSlot<T>(): FetchSlot<T> {
  return { data: null, dataFor: null, error: null, settledFor: null, loading: true };
}

export const started = <T>(s: FetchSlot<T>): FetchSlot<T> => ({ ...s, loading: true, error: null });

export const succeeded = <T>(deps: Deps, data: T): FetchSlot<T> => ({ data, dataFor: deps, error: null, settledFor: deps, loading: false });

/** Keeps the old data (it may still be right for its own key, e.g. a failed reload after a sync). */
export const failed = <T>(s: FetchSlot<T>, deps: Deps, error: Error): FetchSlot<T> => ({ ...s, error, settledFor: deps, loading: false });

/** Optimistic edit of the current key's data; ignored when the data belongs to another key. */
export function patched<T>(s: FetchSlot<T>, deps: Deps, next: T | ((prev: T | null) => T | null)): FetchSlot<T> {
  if (!sameDeps(s.dataFor, deps)) return s;
  return { ...s, data: typeof next === 'function' ? (next as (p: T | null) => T | null)(s.data) : next };
}

export function view<T>(s: FetchSlot<T>, deps: Deps): { data: T | null; error: Error | null; loading: boolean } {
  const settled = sameDeps(s.settledFor, deps);
  return {
    data: sameDeps(s.dataFor, deps) ? s.data : null,
    error: settled ? s.error : null,
    loading: s.loading || !settled,
  };
}

export const toError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)));
