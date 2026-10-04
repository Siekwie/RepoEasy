import { useState } from 'react';
import { NavLink, Outlet, Link } from 'react-router-dom';
import { useApp } from '../context.tsx';
import { fmtDateTime, relative } from '../lib/format.ts';
import { useInterval } from '../lib/hooks.ts';
import { Icon, Logo, type IconName } from './Icon.tsx';
import { Avatar, Meter, PlanBadge } from './ui.tsx';

const NAV: Array<{ to: string; label: string; icon: IconName; end?: boolean }> = [
  { to: '/', label: 'Overview', icon: 'overview', end: true },
  { to: '/repos', label: 'Repositories', icon: 'repos' },
  { to: '/following', label: 'Following', icon: 'eye' },
  { to: '/activity', label: 'Activity', icon: 'activity' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

function SyncControl() {
  const { sync, startSync } = useApp();
  const [, tick] = useState(0);
  useInterval(() => tick((n) => n + 1), 60_000, true);
  const running = !!sync?.running;
  let text: string;
  if (running) text = sync?.step ? `Syncing: ${sync.step}` : 'Syncing…';
  else if (sync?.lastSyncAt) text = `Synced ${relative(sync.lastSyncAt)}`;
  else text = 'Not synced yet';
  const title = [
    sync?.lastSyncAt ? `Last sync ${fmtDateTime(sync.lastSyncAt)}` : null,
    sync?.nextSyncAt ? `Next automatic sync ${fmtDateTime(sync.nextSyncAt)}` : null,
    sync?.rateLimitRemaining != null ? `GitHub API calls left: ${sync.rateLimitRemaining}` : null,
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <div className="sync" title={title || undefined}>
      <span className={`sync-text ${running ? 'is-running' : ''}`} role="status">
        {sync?.lastError && !running ? (
          <span className="sync-error" title={sync.lastError}>
            <Icon name="warn" size={14} /> Sync failed
          </span>
        ) : (
          text
        )}
      </span>
      <button className="btn btn-sm" onClick={() => void startSync()} disabled={running} aria-label="Sync now">
        <Icon name="sync" size={14} className={running ? 'spin' : ''} />
        <span className="hide-sm">{running ? 'Syncing' : 'Sync now'}</span>
      </button>
    </div>
  );
}

export function Shell() {
  const { me, info, toggleTheme, effectiveTheme, signOut } = useApp();
  if (!me) return null;
  const limits = me.limits;
  return (
    <div className="shell">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <aside className="side">
        <Link to="/" className="brand" aria-label="RepoEasy home">
          <Logo />
          <span>RepoEasy</span>
        </Link>
        <nav className="nav" aria-label="Main">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')}>
              <Icon name={n.icon} size={18} />
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <div className="usage">
            <div className="usage-row">
              <span>Tracked</span>
              <span className="num">
                {me.usage.tracked}
                {limits.trackedRepos != null ? ` / ${limits.trackedRepos}` : ''}
              </span>
            </div>
            <Meter value={me.usage.tracked} max={limits.trackedRepos} label="Tracked repositories" />
            <div className="usage-row">
              <span>Following</span>
              <span className="num">
                {me.usage.followed}
                {limits.followedRepos != null ? ` / ${limits.followedRepos}` : ''}
              </span>
            </div>
            <Meter value={me.usage.followed} max={limits.followedRepos} label="Followed repositories" />
            {info.billing.enabled && me.plan === 'free' && (
              <Link to="/settings#plan" className="usage-upgrade">
                Upgrade to Pro
              </Link>
            )}
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="top">
          <Link to="/" className="brand brand-top" aria-label="RepoEasy home">
            <Logo size={24} />
          </Link>
          <SyncControl />
          <div className="top-right">
            <button className="btn btn-icon" onClick={toggleTheme} aria-label={`Switch to ${effectiveTheme === 'dark' ? 'light' : 'dark'} theme`} title="Toggle theme">
              <Icon name={effectiveTheme === 'dark' ? 'sun' : 'moon'} size={16} />
            </button>
            <Link to="/settings" className="userchip" title={`Signed in as ${me.login}`}>
              <Avatar src={me.avatarUrl} name={me.login} size={26} />
              <span className="userchip-name hide-sm">{me.login}</span>
              <PlanBadge plan={me.plan} />
            </Link>
            <button className="btn btn-icon" onClick={() => void signOut()} aria-label="Sign out" title="Sign out">
              <Icon name="logout" size={16} />
            </button>
          </div>
        </header>
        {me.isDemo && (
          <div className="banner" role="note">
            You're looking at a demo with sample data. It's read-only, so changes are turned off.
          </div>
        )}
        <main id="main" tabIndex={-1} className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
