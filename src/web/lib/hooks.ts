import { useCallback, useEffect, useLayoutEffect, useRef, useState, type DependencyList } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Range } from '../../shared/api.ts';
import { failed, initialSlot, patched, started, succeeded, toError, view, type FetchSlot } from './fetch-state.ts';
import { parseRange } from './format.ts';

export interface FetchState<T> {
  /** Only ever data fetched for the current `deps`; null while a new key loads. */
  data: T | null;
  /** The latest request failed. `data` may still be set (same key, stale) so pages can show both. */
  error: Error | null;
  loading: boolean;
  reload: () => void;
  setData: (d: T | ((prev: T | null) => T | null)) => void;
}

/**
 * Fetch keyed by `deps`: changing them drops the old data (it belongs to another key) and refetches.
 * Changing `refresh` (e.g. the sync version) refetches the same key and keeps its data on screen
 * meanwhile, so a reload after a sync does not flicker.
 */
export function useFetch<T>(fn: () => Promise<T>, deps: DependencyList, refresh: unknown = 0): FetchState<T> {
  const [slot, setSlot] = useState<FetchSlot<T>>(initialSlot);
  const seq = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const depsRef = useRef(deps);
  depsRef.current = deps;

  // biome-ignore lint/correctness/useExhaustiveDependencies: the caller's deps are the key, and fn is read through a ref
  const run = useCallback(() => {
    const id = ++seq.current;
    const key = deps;
    setSlot((s) => started(s));
    fnRef.current().then(
      (d) => {
        if (id === seq.current) setSlot(succeeded(key, d));
      },
      (e: unknown) => {
        if (id === seq.current) setSlot((s) => failed(s, key, toError(e)));
      },
    );
  }, [...deps, refresh]);

  useEffect(() => {
    run();
    return () => {
      seq.current++;
    };
  }, [run]);

  const setData = useCallback((d: T | ((prev: T | null) => T | null)) => {
    setSlot((s) => patched(s, depsRef.current, d));
  }, []);

  return { ...view(slot, deps), reload: run, setData };
}

export function useTitle(title: string): void {
  useEffect(() => {
    const prev = document.title;
    document.title = title ? `${title} · RepoEasy` : 'RepoEasy';
    return () => {
      document.title = prev;
    };
  }, [title]);
}

/**
 * Width of an element. Returns a callback ref (not a ref object) so the observer attaches whenever the
 * element actually mounts, including when it only appears after data arrives.
 */
export function useSize<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [el, setEl] = useState<T | null>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (e) setW(Math.round(e.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, w];
}

/** The `?range=` query param, with a setter that keeps other params and replaces the history entry. */
export function useRangeParam(): [Range, (r: Range) => void] {
  const [sp, setSp] = useSearchParams();
  const range = parseRange(sp.get('range'));
  const setRange = useCallback(
    (r: Range) =>
      setSp(
        (prev) => {
          const n = new URLSearchParams(prev);
          n.set('range', r);
          return n;
        },
        { replace: true },
      ),
    [setSp],
  );
  return [range, setRange];
}

export function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function lsSet(key: string, value: string | null): void {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

/** Run `cb` every `ms` while `active`. */
export function useInterval(cb: () => void, ms: number, active: boolean): void {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => ref.current(), ms);
    return () => clearInterval(t);
  }, [ms, active]);
}
