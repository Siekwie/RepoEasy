import { useState, type ReactNode } from 'react';
import type { Plan } from '../../shared/api.ts';
import { useApp } from '../context.tsx';
import { download } from '../lib/api.ts';
import { compact, exact, pctChange, signed } from '../lib/format.ts';
import type { FetchState } from '../lib/hooks.ts';
import { saveBlob } from '../lib/save-blob.ts';
import { Icon } from './Icon.tsx';

export function Num({ v, className }: { v: number | null | undefined; className?: string }) {
  return (
    <span className={`num ${className ?? ''}`} title={v == null ? undefined : exact(v)}>
      {compact(v)}
    </span>
  );
}

/** Signed delta with arrow, always carries text, never colour alone. */
export function SignedDelta({ value, suffix }: { value: number; suffix?: string }) {
  const dir = value > 0 ? 'up' : value < 0 ? 'down' : 'flat';
  return (
    <span className={`delta delta-${dir}`} title={`${value > 0 ? '+' : ''}${exact(value)}${suffix ? ` ${suffix}` : ''}`}>
      {dir !== 'flat' && <span aria-hidden="true">{dir === 'up' ? '▲' : '▼'}</span>}
      {signed(value)}
      {suffix ? <span className="delta-suffix"> {suffix}</span> : null}
    </span>
  );
}

export function PctDelta({ cur, prev, label }: { cur: number; prev: number | null | undefined; label?: string }) {
  if (prev == null) return null;
  const c = pctChange(cur, prev);
  if (c == null) {
    return (
      <span className="delta delta-up" title={`Previous period: ${exact(prev)}`}>
        <span aria-hidden="true">▲</span>new{label ? ` ${label}` : ''}
      </span>
    );
  }
  const dir = c > 0.5 ? 'up' : c < -0.5 ? 'down' : 'flat';
  const text = `${c > 0 ? '+' : c < 0 ? '−' : ''}${Math.abs(c) < 10 ? Math.abs(c).toFixed(1) : Math.round(Math.abs(c))}%`;
  return (
    <span className={`delta delta-${dir}`} title={`Previous period: ${exact(prev)}`}>
      {dir !== 'flat' && <span aria-hidden="true">{dir === 'up' ? '▲' : '▼'}</span>}
      {text}
      {label ? <span className="delta-suffix"> {label}</span> : null}
    </span>
  );
}

export function Tile(props: { label: string; value: number | null | undefined; sub?: ReactNode; icon?: ReactNode; hint?: string }) {
  return (
    <div className="tile">
      <div className="tile-label">
        {props.icon}
        {props.hint ? (
          <>
            <span className="has-hint" title={props.hint}>
              {props.label}
            </span>
            <span className="sr-only">. {props.hint}</span>
          </>
        ) : (
          props.label
        )}
      </div>
      <div className="tile-value">
        <Num v={props.value} />
      </div>
      {props.sub != null && <div className="tile-sub">{props.sub}</div>}
    </div>
  );
}

export function Seg<T extends string>(props: {
  value: T;
  options: Array<{ value: T; label: string; title?: string }>;
  onChange: (v: T) => void;
  label: string;
  small?: boolean;
}) {
  return (
    <div className={`seg ${props.small ? 'seg-sm' : ''}`} role="group" aria-label={props.label}>
      {props.options.map((o) => (
        <button key={o.value} type="button" aria-pressed={props.value === o.value} title={o.title} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch(props: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; busy?: boolean; hideLabel?: boolean }) {
  return (
    <label className={`switch ${props.disabled ? 'is-disabled' : ''}`}>
      <input
        type="checkbox"
        role="switch"
        aria-checked={props.checked}
        checked={props.checked}
        disabled={props.disabled || props.busy}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <span className="switch-track" aria-hidden="true" />
      <span className={props.hideLabel ? 'sr-only' : 'switch-label'}>{props.label}</span>
    </label>
  );
}

export function PageHead(props: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{props.title}</h1>
        {props.sub != null && <p className="page-sub">{props.sub}</p>}
      </div>
      {props.actions != null && <div className="page-actions">{props.actions}</div>}
    </div>
  );
}

export function Card(props: { title?: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; id?: string; busy?: boolean }) {
  return (
    <section className={`card ${props.className ?? ''}`} id={props.id} aria-busy={props.busy || undefined}>
      {(props.title || props.actions) && (
        <header className="card-head">
          <div>
            {props.title && <h2>{props.title}</h2>}
            {props.sub != null && <p className="card-sub">{props.sub}</p>}
          </div>
          {props.actions != null && <div className="card-actions">{props.actions}</div>}
        </header>
      )}
      {props.children}
    </section>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="spinner-wrap" role="status">
      <span className="spinner" aria-hidden="true" />
      {label ? <span>{label}</span> : <span className="sr-only">Loading</span>}
    </span>
  );
}

export function Skeleton({ height = 120 }: { height?: number }) {
  return <div className="skeleton" style={{ height }} aria-hidden="true" />;
}

export function ErrorBox({ error, onRetry, stale }: { error: Error; onRetry?: () => void; stale?: boolean }) {
  return (
    <div className={`state state-error ${stale ? 'state-stale' : ''}`} role="alert">
      <Icon name="warn" size={20} />
      <div>
        <strong>{stale ? "Couldn't refresh this." : "That didn't load."}</strong>
        <p>
          {error.message}
          {stale ? ' What you see below may be out of date.' : ''}
        </p>
        {onRetry && (
          <button type="button" className="btn btn-sm" onClick={onRetry}>
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Renders a fetch: skeleton while there is no data for the current key, the error (with retry) when it
 * failed, and, when a refetch failed but the same key still has data, that data under a stale-warning.
 */
export function Fetched<T>({ f, height = 120, children }: { f: FetchState<T>; height?: number; children: (data: NonNullable<T>) => ReactNode }) {
  if (f.data == null) return f.error ? <ErrorBox error={f.error} onRetry={f.reload} /> : <Skeleton height={height} />;
  return (
    <>
      {f.error && <ErrorBox error={f.error} onRetry={f.reload} stale />}
      {children(f.data as NonNullable<T>)}
    </>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="state">
      <div>
        <strong>{title}</strong>
        {children && <p>{children}</p>}
        {action}
      </div>
    </div>
  );
}

export function FirstSync({ step }: { step: string | null }) {
  return (
    <div className="state state-first" role="status">
      <span className="spinner spinner-lg" aria-hidden="true" />
      <div>
        <strong>Your first sync is in progress</strong>
        <p>
          RepoEasy is reading your repositories, traffic and star history from GitHub. This can take a minute or two for large accounts. Numbers will appear
          here as soon as they arrive.
        </p>
        {step && <p className="muted">Now: {step}</p>}
      </div>
    </div>
  );
}

export function CopyButton({ text, label = 'Copy', className }: { text: string; label?: string; className?: string }) {
  const { toast } = useApp();
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch {
        toast('Copy failed. Select the text and copy it manually.', 'error');
        ta.remove();
        return;
      }
      ta.remove();
    }
    setDone(true);
    toast('Copied to clipboard', 'success');
    window.setTimeout(() => setDone(false), 1500);
  }
  return (
    <button type="button" className={`btn btn-sm ${className ?? ''}`} onClick={() => void copy()}>
      <Icon name={done ? 'check' : 'copy'} size={14} />
      {done ? 'Copied' : label}
    </button>
  );
}

export function ThemeToggle() {
  const { toggleTheme, effectiveTheme } = useApp();
  return (
    <button type="button" className="btn btn-icon" onClick={toggleTheme} aria-label={`Switch to ${effectiveTheme === 'dark' ? 'light' : 'dark'} theme`} title="Toggle theme">
      <Icon name={effectiveTheme === 'dark' ? 'sun' : 'moon'} size={16} />
    </button>
  );
}

/** Fetches a file and saves it; failures go through `fail` (plan limit, signed out...) instead of becoming a saved error file. */
export function DownloadButton({ path, fallbackName, children, className = 'btn btn-sm' }: { path: string; fallbackName: string; children: ReactNode; className?: string }) {
  const { fail } = useApp();
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const { blob, filename } = await download(path, fallbackName);
      saveBlob(blob, filename);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <button type="button" className={className} disabled={busy} aria-busy={busy || undefined} onClick={() => void save()}>
      {children}
    </button>
  );
}

export function PlanBadge({ plan }: { plan: Plan }) {
  const label = plan === 'selfhost' ? 'Self-hosted' : plan === 'pro' ? 'Pro' : 'Free';
  return <span className={`plan-badge plan-${plan}`}>{label}</span>;
}

export function Avatar({ src, name, size = 28 }: { src: string | null | undefined; name: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return (
      <span className="avatar avatar-fallback" style={{ width: size, height: size, fontSize: size * 0.45 }} aria-hidden="true">
        {name.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return <img className="avatar" src={src} width={size} height={size} alt="" loading="lazy" onError={() => setBroken(true)} />;
}

const USAGE = {
  tracked: { label: 'Tracked repositories', row: 'Tracked', verb: 'Tracking' },
  followed: { label: 'Followed repositories', row: 'Following', verb: 'Following' },
} as const;

/** Usage against the plan limit. `row`: sidebar line, `inline`: page header, `fact`: contents of a settings `dd`. */
export function UsageMeter({ kind, variant }: { kind: 'tracked' | 'followed'; variant: 'row' | 'inline' | 'fact' }) {
  const { me } = useApp();
  const value = me?.usage[kind] ?? 0;
  const max = (kind === 'tracked' ? me?.limits.trackedRepos : me?.limits.followedRepos) ?? null;
  const u = USAGE[kind];
  const meter = <Meter value={value} max={max} label={u.label} />;
  if (variant === 'row') {
    return (
      <>
        <div className="usage-row">
          <span>{u.row}</span>
          <span className="num">
            {value}
            {max != null ? ` / ${max}` : ''}
          </span>
        </div>
        {meter}
      </>
    );
  }
  if (variant === 'fact') {
    return (
      <>
        <span className="num">{value}</span>
        {max != null ? ` of ${max}` : ' (no limit)'}
        {meter}
      </>
    );
  }
  return (
    <div className="usage-inline">
      <span>
        {u.verb} <strong className="num">{value}</strong>
        {max != null ? ` of ${max}` : ' (no limit)'}
      </span>
      {meter}
    </div>
  );
}

export function Meter({ value, max, label }: { value: number; max: number | null; label: string }) {
  const pct = max ? Math.min(100, (value / max) * 100) : 0;
  const full = max != null && value >= max;
  return (
    <div className="meter" role="img" aria-label={`${label}: ${value}${max != null ? ` of ${max}` : ', unlimited'}`}>
      {max != null && <div className={`meter-fill ${full ? 'is-full' : ''}`} style={{ width: `${pct}%` }} />}
    </div>
  );
}

export function LangDot({ color }: { color: string | null | undefined }) {
  return <span className="lang-dot" style={{ background: color ?? 'var(--ink-3)' }} aria-hidden="true" />;
}

export const INSTALL_HINT = 'RepoEasy only sees repositories the GitHub App is installed on.';

/** "Choose repositories on GitHub": only rendered when sign-in runs through a GitHub App. */
export function InstallRepos({ button, hint = true }: { button?: boolean; hint?: boolean }) {
  const { info } = useApp();
  const url = info.auth.githubAppInstallUrl;
  if (!url) return null;
  return (
    <span className="install-repos">
      <a className={button ? 'btn btn-sm' : 'install-link'} href={url} target="_blank" rel="noreferrer">
        Choose repositories on GitHub
        <Icon name="external" size={13} />
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
      {hint && <span className="muted"> {INSTALL_HINT}</span>}
    </span>
  );
}
