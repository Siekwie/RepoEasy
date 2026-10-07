import { Component, Suspense, lazy, useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppProvider, useBoot } from './context.tsx';
import { Icon, Logo } from './components/Icon.tsx';
import { Spinner } from './components/ui.tsx';
import { Landing } from './pages/Landing.tsx';
import type { AppInfo, Me } from '../shared/api.ts';

// Everything behind sign-in (and the chart code it needs) loads on demand, so the landing page and
// public share pages do not download the dashboard.
const Shell = lazy(() => import('./components/Shell.tsx').then((m) => ({ default: m.Shell })));
const Overview = lazy(() => import('./pages/Overview.tsx').then((m) => ({ default: m.Overview })));
const Repos = lazy(() => import('./pages/Repos.tsx').then((m) => ({ default: m.Repos })));
const RepoDetailPage = lazy(() => import('./pages/RepoDetail.tsx').then((m) => ({ default: m.RepoDetailPage })));
const Following = lazy(() => import('./pages/Following.tsx').then((m) => ({ default: m.Following })));
const Activity = lazy(() => import('./pages/Activity.tsx').then((m) => ({ default: m.Activity })));
const Settings = lazy(() => import('./pages/Settings.tsx').then((m) => ({ default: m.Settings })));
const NotFound = lazy(() => import('./pages/NotFound.tsx').then((m) => ({ default: m.NotFound })));
const PublicShare = lazy(() => import('./pages/PublicShare.tsx').then((m) => ({ default: m.PublicShare })));
const Imprint = lazy(() => import('./pages/Legal.tsx').then((m) => ({ default: m.Imprint })));
const Privacy = lazy(() => import('./pages/Legal.tsx').then((m) => ({ default: m.Privacy })));
const Terms = lazy(() => import('./pages/Legal.tsx').then((m) => ({ default: m.Terms })));

function ScrollTop() {
  const { pathname } = useLocation();
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new pathname is the trigger
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

/** Same look as the first-load screen, so a lazy chunk arriving does not flash a different loader. */
function BootScreen() {
  return (
    <div className="boot">
      <Logo size={40} />
      <Spinner label="Loading RepoEasy" />
    </div>
  );
}

/** A lazy chunk can fail to load (offline, or a newer deploy replaced its file): offer a reload instead of a blank page. */
class LoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="boot" role="alert">
        <Logo size={40} />
        <h1>This page didn't load</h1>
        <p className="muted">Check your connection, or RepoEasy may have just been updated.</p>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
          <Icon name="sync" size={14} /> Reload
        </button>
      </div>
    );
  }
}

function Routed({ me }: { me: Me | null }) {
  return (
    <>
      <ScrollTop />
      <LoadBoundary>
        <Suspense fallback={<BootScreen />}>
          <Routes>
            <Route path="/s/:owner/:repo" element={<PublicShare />} />
            <Route path="/imprint" element={<Imprint />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />
            {me ? (
              <Route element={<Shell />}>
                <Route index element={<Overview />} />
                <Route path="repos" element={<Repos />} />
                <Route path="repos/:id" element={<RepoDetailPage />} />
                <Route path="following" element={<Following />} />
                <Route path="activity" element={<Activity />} />
                <Route path="settings" element={<Settings />} />
                <Route path="*" element={<NotFound />} />
              </Route>
            ) : (
              <>
                <Route path="/" element={<Landing />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </>
            )}
          </Routes>
        </Suspense>
      </LoadBoundary>
    </>
  );
}

function Gate({ info, me }: { info: AppInfo | null; me: Me | null }) {
  const { boot, retry } = useBoot();
  if (boot.status === 'loading' || (boot.status === 'ready' && !info)) return <BootScreen />;
  if (boot.status === 'error') {
    return (
      <div className="boot" role="alert">
        <Logo size={40} />
        <h1>RepoEasy can't reach its server</h1>
        <p className="muted">{boot.message}</p>
        <button type="button" className="btn btn-primary" onClick={retry}>
          <Icon name="sync" size={14} /> Try again
        </button>
      </div>
    );
  }
  return <Routed me={me} />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AppProvider>{(info, me) => <Gate info={info} me={me} />}</AppProvider>
    </BrowserRouter>
  );
}
