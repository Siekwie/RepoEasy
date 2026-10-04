import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppProvider, useBoot } from './context.tsx';
import { Shell } from './components/Shell.tsx';
import { Icon, Logo } from './components/Icon.tsx';
import { Spinner } from './components/ui.tsx';
import { Activity } from './pages/Activity.tsx';
import { Following } from './pages/Following.tsx';
import { Landing } from './pages/Landing.tsx';
import { NotFound } from './pages/NotFound.tsx';
import { Overview } from './pages/Overview.tsx';
import { PublicShare } from './pages/PublicShare.tsx';
import { RepoDetailPage } from './pages/RepoDetail.tsx';
import { Repos } from './pages/Repos.tsx';
import { Settings } from './pages/Settings.tsx';
import type { AppInfo, Me } from '../shared/api.ts';

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function Routed({ me }: { me: Me | null }) {
  return (
    <>
      <ScrollTop />
      <Routes>
        <Route path="/s/:owner/:repo" element={<PublicShare />} />
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
    </>
  );
}

function Gate({ info, me }: { info: AppInfo | null; me: Me | null }) {
  const { boot, retry } = useBoot();
  if (boot.status === 'loading' || (boot.status === 'ready' && !info)) {
    return (
      <div className="boot">
        <Logo size={40} />
        <Spinner label="Loading RepoEasy" />
      </div>
    );
  }
  if (boot.status === 'error') {
    return (
      <div className="boot" role="alert">
        <Logo size={40} />
        <h1>RepoEasy can't reach its server</h1>
        <p className="muted">{boot.message}</p>
        <button className="btn btn-primary" onClick={retry}>
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
