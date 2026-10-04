import { useCallback, useEffect, useLayoutEffect, useRef, useState, type DependencyList, type RefObject } from 'react';

export interface FetchState<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  reload: () => void;
  setData: (d: T | ((prev: T | null) => T | null)) => void;
}

/** Fetch with stale-while-revalidate: previous data stays while a refetch runs. */
export function useFetch<T>(fn: () => Promise<T>, deps: DependencyList): FetchState<T> {
  const [state, setState] = useState<{ data: T | null; error: Error | null; loading: boolean }>({
    data: null,
    error: null,
    loading: true,
  });
  const seq = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(() => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    fnRef.current().then(
      (d) => {
        if (id === seq.current) setState({ data: d, error: null, loading: false });
      },
      (e: unknown) => {
        if (id === seq.current) setState((s) => ({ data: s.data, error: e instanceof Error ? e : new Error(String(e)), loading: false }));
      },
    );
  }, deps);

  useEffect(() => {
    run();
    return () => {
      seq.current++;
    };
  }, [run]);

  const setData = useCallback((d: T | ((prev: T | null) => T | null)) => {
    setState((s) => ({ ...s, data: typeof d === 'function' ? (d as (p: T | null) => T | null)(s.data) : d }));
  }, []);

  return { ...state, reload: run, setData };
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

export function useSize<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (e) setW(Math.round(e.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
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
