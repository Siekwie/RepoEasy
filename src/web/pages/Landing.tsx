import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type { AppInfo, PlanLimits } from '../../shared/api.ts';
import { useApp } from '../context.tsx';
import { api } from '../lib/api.ts';
import { useTitle } from '../lib/hooks.ts';
import { landingSource } from '../lib/visit.ts';
import { Icon, Logo } from '../components/Icon.tsx';
import { SiteLinks, SOURCE_URL } from '../components/SiteLinks.tsx';
import { ThemeToggle } from '../components/ui.tsx';

/** Deterministic pseudo-random so the illustration is stable between renders. */
function illustration(n: number): number[] {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const trend = 0.18 + 0.5 * t ** 1.4;
    const wave = 0.08 * Math.sin(i / 5.5) + 0.05 * Math.sin(i / 1.7);
    const spike = Math.exp(-(((t - 0.58) / 0.025) ** 2)) * 0.28 + Math.exp(-(((t - 0.83) / 0.02) ** 2)) * 0.18;
    out.push(Math.max(0.04, trend + wave + spike + (rnd() - 0.5) * 0.07));
  }
  return out;
}

function HeroChart() {
  const W = 600;
  const H = 360;
  const padL = 14;
  const padR = 14;
  const top = 64;
  const base = H - 34;
  const data = useMemo(() => illustration(78), []);
  const x = (i: number) => padL + (i / (data.length - 1)) * (W - padL - padR);
  const y = (v: number) => base - v * (base - top - 20);
  const line = data.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const windowW = 26;
  const wx = W - padR - windowW;
  return (
    <figure className="hero-fig">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby="hero-cap" className="hero-svg">
        <title id="hero-cap">Illustration: a long traffic history of which GitHub only shows the most recent 14 days</title>
        <line className="grid" x1={padL} x2={W - padR} y1={base} y2={base} />
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} className="grid" x1={padL} x2={W - padR} y1={base - f * (base - top)} y2={base - f * (base - top)} />
        ))}
        <path d={`${line}L${x(data.length - 1)},${base}L${x(0)},${base}Z`} className="hero-area" />
        <path d={line} pathLength={1} className="hero-line" />
        <rect x={wx} y={top - 6} width={windowW} height={base - top + 6} className="hero-window" />
        <line x1={wx} x2={wx} y1={top - 6} y2={base} className="hero-window-edge" />
        <text x={padL} y={26} className="hero-label hero-label-strong">
          What RepoEasy keeps
        </text>
        <text x={padL} y={44} className="hero-label">
          Every day since you started tracking
        </text>
        <text x={wx - 8} y={26} textAnchor="end" className="hero-label hero-label-muted">
          What GitHub shows
        </text>
        <text x={wx - 8} y={44} textAnchor="end" className="hero-label hero-label-muted">
          The last 14 days
        </text>
        <path d={`M${wx - 4},${34} L${wx + windowW / 2},${top - 10}`} className="hero-leader" />
        <text x={padL} y={H - 10} className="axis-label">
          Day 1
        </text>
        <text x={W - padR} y={H - 10} textAnchor="end" className="axis-label">
          Today
        </text>
      </svg>
      <figcaption>Illustrative data.</figcaption>
    </figure>
  );
}

/**
 * A button that starts signing in: straight to GitHub when that login is set up, otherwise down to
 * the sign-in form on this page.
 * `source`: where this visitor came from, passed along so a new account can be credited to it.
 */
function SignInLink({ info, source, className, children }: { info: AppInfo; source: string; className: string; children: ReactNode }) {
  if (!info.auth.github) {
    return (
      <a className={className} href="#signin">
        {children}
      </a>
    );
  }
  return (
    <a className={className} rel="nofollow" href={`/auth/github${source ? `?src=${encodeURIComponent(source)}` : ''}`}>
      {children}
    </a>
  );
}

function SignIn({ info, source }: { info: AppInfo; source: string }) {
  const { reloadMe } = useApp();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'local' | 'demo' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { github, local, localNeedsPassword, demo } = info.auth;

  async function signInLocal(e: FormEvent) {
    e.preventDefault();
    setBusy('local');
    setError(null);
    try {
      await api.authLocal(password || undefined);
      await reloadMe();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setBusy(null);
    }
  }
  async function signInDemo() {
    setBusy('demo');
    setError(null);
    try {
      await api.authDemo(source);
      await reloadMe();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the demo.');
    } finally {
      setBusy(null);
    }
  }

  if (!github && !local && !demo) {
    return (
      <div className="signin" id="signin">
        <p className="note">No sign-in method is set up on this server yet. The server owner needs to configure GitHub login or local sign-in.</p>
      </div>
    );
  }

  return (
    <div className="signin" id="signin">
      {github && (
        <SignInLink info={info} source={source} className="btn btn-primary btn-lg">
          <Icon name="github" size={18} /> Sign in with GitHub
        </SignInLink>
      )}
      {local && (
        <form className="signin-local" onSubmit={(e) => void signInLocal(e)}>
          {localNeedsPassword && (
            <label className="field">
              <span className="field-label">Password</span>
              <input type="password" value={password} autoComplete="current-password" onChange={(e) => setPassword(e.target.value)} />
            </label>
          )}
          <button className={`btn btn-lg ${github ? '' : 'btn-primary'}`} type="submit" disabled={busy !== null}>
            {busy === 'local' ? 'Signing in…' : 'Sign in on this server'}
          </button>
          <p className="muted small">Single-user mode: you'll be signed in as the account this server is set up for.</p>
        </form>
      )}
      {demo && (
        <button type="button" className="btn btn-lg" onClick={() => void signInDemo()} disabled={busy !== null}>
          {busy === 'demo' ? 'Opening demo…' : 'Try the live demo'}
        </button>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {github && (
        <p className="muted small signin-note">
          GitHub will ask for access to your repositories, because it has no narrower permission that includes traffic numbers. RepoEasy only reads them, and{' '}
          <a href={SOURCE_URL} target="_blank" rel="noreferrer">
            the code is open source
          </a>
          .
        </p>
      )}
    </div>
  );
}

const FEATURES: Array<{ title: string; body: string }> = [
  {
    title: 'Traffic past 14 days',
    body: 'GitHub only keeps views and clones for two weeks. RepoEasy saves them every day, so you can look back months or years and see what a launch or a blog post really did.',
  },
  {
    title: 'Follow any public repository',
    body: "Track stars, forks, issues and releases for projects you don't own, on GitHub or Codeberg: a dependency, a competitor, or an idea you want to watch grow.",
  },
  {
    title: 'One view across all your repositories',
    body: 'Lifetime totals, top repositories, referrers, languages and a commit calendar, all in a single overview.',
  },
  {
    title: 'Stars and releases, with history',
    body: 'Daily snapshots, star history backfilled from before you signed up, and release download counts over time.',
  },
  {
    title: 'Private repositories included',
    body: "Repositories you can push to are supported, private or public. Public share pages and badges are always opt-in, one repository at a time.",
  },
  {
    title: 'Self-host it or use the hosted version',
    body: 'Run it on your own machine with everything unlocked, or let us run it for you.',
  },
];

function limitLine(n: number | null, noun: string): string {
  return n == null ? `Unlimited ${noun}` : `${n} ${noun}`;
}

function Pricing({ info, source }: { info: AppInfo; source: string }) {
  const free: PlanLimits = info.limits.free;
  const pro: PlanLimits = info.limits.pro;
  return (
    <section className="land-section" aria-labelledby="pricing">
      <h2 id="pricing">Pricing</h2>
      <p className="land-lede">Lifetime history is free. Pay only when you need more repositories or automation.</p>
      <div className="plans">
        <div className="plan">
          <h3>Free</h3>
          <p className="plan-price">
            <span>$0</span>
          </p>
          <ul>
            <li>{limitLine(free.trackedRepos, 'tracked repositories')}</li>
            <li>{limitLine(free.followedRepos, 'followed repositories')}</li>
            <li>Sync every {free.syncIntervalHours} hours</li>
            <li>Full lifetime history</li>
            <li>Export your data any time</li>
          </ul>
          <SignInLink info={info} source={source} className="btn">
            Start free
          </SignInLink>
        </div>
        <div className="plan plan-pro">
          <h3>Pro</h3>
          <p className="plan-price">
            <span>{info.billing.proMonthly}</span>/month
            <small> or {info.billing.proYearly}/year</small>
          </p>
          <ul>
            <li>{limitLine(pro.trackedRepos, 'tracked repositories')}</li>
            <li>{limitLine(pro.followedRepos, 'followed repositories')}</li>
            <li>Sync every {pro.syncIntervalHours} hours</li>
            {pro.apiTokens && <li>API tokens</li>}
            {pro.webhooks && <li>Webhook alerts for milestones and spikes</li>}
            {pro.sharePages && <li>Public share pages and README badges</li>}
          </ul>
          <SignInLink info={info} source={source} className="btn btn-primary">
            Start free, upgrade later
          </SignInLink>
        </div>
      </div>
    </section>
  );
}

export function Landing() {
  useTitle('GitHub traffic history beyond 14 days');
  const { info } = useApp();
  const [source, setSource] = useState('');
  useEffect(() => {
    let live = true;
    void landingSource().then((s) => {
      if (live) setSource(s);
    });
    return () => {
      live = false;
    };
  }, []);
  return (
    <div className="landing">
      <header className="land-top">
        <a href="/" className="brand" aria-label="RepoEasy home">
          <Logo />
          <span>RepoEasy</span>
        </a>
        <div className="land-top-right">
          <SignInLink info={info} source={source} className="btn btn-sm btn-quiet">
            Sign in
          </SignInLink>
          <ThemeToggle />
        </div>
      </header>
      <main id="main">
        <section className="hero">
          <div className="hero-copy">
            <h1>
              GitHub forgets your traffic after 14 days. <span className="hero-h1-second">RepoEasy keeps it.</span>
            </h1>
            <p className="hero-lede">
              Sign in once and RepoEasy archives views, visitors, clones, referrers and stars for your repositories every day. Months later you can still answer "did that
              launch actually work?"
            </p>
            <SignIn info={info} source={source} />
          </div>
          <HeroChart />
        </section>

        <section className="land-section" aria-labelledby="features">
          <h2 id="features">What you get</h2>
          <dl className="features">
            {FEATURES.map((f) => (
              <div key={f.title}>
                <dt>{f.title}</dt>
                <dd>{f.body}</dd>
              </div>
            ))}
          </dl>
        </section>

        {info.billing.enabled && <Pricing info={info} source={source} />}
      </main>
      <footer className="land-foot">
        <span>
          RepoEasy {info.version} <span className="muted">· Not affiliated with GitHub.</span>
        </span>
        <SiteLinks />
      </footer>
    </div>
  );
}
