import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AppInfo, Me, SyncStatus } from '../shared/api.ts';
import { ApiException, api } from './lib/api.ts';
import { lsGet, lsSet } from './lib/hooks.ts';

export type ThemePref = 'system' | 'light' | 'dark';
type ToastKind = 'info' | 'error' | 'success';
interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
}

export interface AppCtx {
  info: AppInfo;
  me: Me | null;
  setMe: (m: Me) => void;
  reloadMe: () => Promise<void>;
  sync: SyncStatus | null;
  startSync: () => Promise<void>;
  /** Increments whenever a sync finishes; include in fetch deps to refresh data. */
  syncVersion: number;
  toast: (text: string, kind?: ToastKind) => void;
  fail: (e: unknown) => void;
  promptUpgrade: (message: string) => void;
  startCheckout: (interval: 'month' | 'year') => Promise<void>;
  themePref: ThemePref;
  effectiveTheme: 'light' | 'dark';
  setThemePref: (t: ThemePref) => void;
  toggleTheme: () => void;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp outside AppProvider');
  return c;
}

export type BootState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready' };

const BootCtx = createContext<{ boot: BootState; retry: () => void } | null>(null);
export function useBoot() {
  const c = useContext(BootCtx);
  if (!c) throw new Error('useBoot outside AppProvider');
  return c;
}

const THEME_KEY = 'repoeasy-theme';

function readThemePref(): ThemePref {
  const v = lsGet(THEME_KEY);
  return v === 'light' || v === 'dark' ? v : 'system';
}

export function AppProvider({ children }: { children: (info: AppInfo | null, me: Me | null) => ReactNode }) {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [me, setMeState] = useState<Me | null>(null);
  const [boot, setBoot] = useState<BootState>({ status: 'loading' });
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [syncVersion, setSyncVersion] = useState(0);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [upgrade, setUpgrade] = useState<string | null>(null);
  const [themePref, setThemePrefState] = useState<ThemePref>(readThemePref);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const toastId = useRef(0);

  // ---- boot
  const load = useCallback(async () => {
    setBoot({ status: 'loading' });
    try {
      const [i, m] = await Promise.all([
        api.info(),
        api.me().catch((e: unknown) => {
          if (e instanceof ApiException && e.status === 401) return null;
          throw e;
        }),
      ]);
      setInfo(i);
      setMeState(m);
      setBoot({ status: 'ready' });
    } catch (e) {
      setBoot({ status: 'error', message: e instanceof Error ? e.message : 'Could not load RepoEasy.' });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const reloadMe = useCallback(async () => {
    try {
      setMeState(await api.me());
    } catch (e) {
      if (e instanceof ApiException && e.status === 401) setMeState(null);
    }
  }, []);

  const setMe = useCallback((m: Me) => setMeState(m), []);

  useEffect(() => {
    if (me) setSync(me.sync);
    else setSync(null);
  }, [me]);

  // ---- theme
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    if (themePref === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', themePref);
  }, [themePref]);
  const effectiveTheme: 'light' | 'dark' = themePref === 'system' ? (systemDark ? 'dark' : 'light') : themePref;
  const setThemePref = useCallback((t: ThemePref) => {
    setThemePrefState(t);
    lsSet(THEME_KEY, t === 'system' ? null : t);
  }, []);
  const toggleTheme = useCallback(() => {
    setThemePref(effectiveTheme === 'dark' ? 'light' : 'dark');
  }, [effectiveTheme, setThemePref]);

  // ---- toasts & errors
  const toast = useCallback((text: string, kind: ToastKind = 'info') => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 4000);
  }, []);

  const fail = useCallback(
    (e: unknown) => {
      if (e instanceof ApiException) {
        if (e.code === 'plan-limit') return setUpgrade(e.message);
        if (e.code === 'demo-readonly') return toast('The demo is read-only. Sign in with your own account to make changes.', 'error');
        if (e.code === 'unauthorized' || e.status === 401) {
          setMeState(null);
          return toast('Your session ended. Sign in again.', 'error');
        }
        return toast(e.message, 'error');
      }
      toast(e instanceof Error ? e.message : 'Something went wrong.', 'error');
    },
    [toast],
  );

  // ---- sync
  const startSync = useCallback(async () => {
    try {
      setSync(await api.startSync());
    } catch (e) {
      fail(e);
    }
  }, [fail]);

  const running = !!sync?.running && !!me;
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(async () => {
      try {
        const s = await api.syncStatus();
        setSync(s);
        if (!s.running) {
          setSyncVersion((v) => v + 1);
          void reloadMe();
        }
      } catch {
        /* keep polling */
      }
    }, 2000);
    return () => window.clearInterval(t);
  }, [running, reloadMe]);

  const startCheckout = useCallback(
    async (interval: 'month' | 'year') => {
      try {
        const { url } = await api.checkout(interval);
        window.location.href = url;
      } catch (e) {
        fail(e);
      }
    },
    [fail],
  );

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch (e) {
      fail(e);
      return;
    }
    setMeState(null);
    window.location.assign('/');
  }, [fail]);

  const value = useMemo<AppCtx | null>(
    () =>
      info
        ? {
            info,
            me,
            setMe,
            reloadMe,
            sync,
            startSync,
            syncVersion,
            toast,
            fail,
            promptUpgrade: setUpgrade,
            startCheckout,
            themePref,
            effectiveTheme,
            setThemePref,
            toggleTheme,
            signOut,
          }
        : null,
    [info, me, setMe, reloadMe, sync, startSync, syncVersion, toast, fail, startCheckout, themePref, effectiveTheme, setThemePref, toggleTheme, signOut],
  );

  const bootValue = useMemo(() => ({ boot, retry: () => void load() }), [boot, load]);

  const billing = info?.billing.enabled ?? false;

  return (
    <BootCtx.Provider value={bootValue}>
      {value ? (
        <Ctx.Provider value={value}>
          {children(info, me)}
          <div className="toasts" role="status" aria-live="polite">
            {toasts.map((t) => (
              <div key={t.id} className={`toast toast-${t.kind}`}>
                {t.text}
              </div>
            ))}
          </div>
          {upgrade !== null && (
            <UpgradeDialog
              message={upgrade}
              billing={billing}
              plan={me?.plan ?? 'free'}
              onClose={() => setUpgrade(null)}
              onCheckout={(i) => void startCheckout(i)}
              info={info!}
            />
          )}
        </Ctx.Provider>
      ) : (
        children(null, null)
      )}
    </BootCtx.Provider>
  );
}

function UpgradeDialog(props: {
  message: string;
  billing: boolean;
  plan: string;
  info: AppInfo;
  onClose: () => void;
  onCheckout: (i: 'month' | 'year') => void;
}) {
  const { message, billing, plan, info, onClose, onCheckout } = props;
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const on = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);
  const canUpgrade = billing && plan === 'free';
  return (
    <div className="scrim" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="upg-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="upg-title">{canUpgrade ? 'This needs Pro' : 'Plan limit reached'}</h2>
        <p>{message}</p>
        {canUpgrade && (
          <p className="muted">
            Pro: unlimited tracked repositories, {info.limits.pro.followedRepos ?? 'unlimited'} followed, sync every {info.limits.pro.syncIntervalHours} hours, API
            tokens, webhook alerts and public share pages.
          </p>
        )}
        <div className="dialog-actions">
          {canUpgrade && (
            <>
              <button className="btn btn-primary" onClick={() => onCheckout('month')}>
                Pro {info.billing.proMonthly}/month
              </button>
              <button className="btn" onClick={() => onCheckout('year')}>
                Pro {info.billing.proYearly}/year
              </button>
            </>
          )}
          <button className="btn btn-quiet" ref={ref} onClick={onClose}>
            {canUpgrade ? 'Not now' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
