import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Logo } from '../components/Icon.tsx';
import { Admin } from '../pages/Admin.tsx';
import '../styles.css';

// The owner's admin interface: the Admin page on its own, without the app around it. It is served
// by src/server/admin-web.ts on loopback, where there is no account and nobody to sign in.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div className="main">
      <header className="top">
        <span className="brand brand-admin">
          <Logo size={24} />
          <span>RepoEasy</span>
        </span>
      </header>
      <main className="content">
        <Admin />
      </main>
    </div>
  </StrictMode>,
);
