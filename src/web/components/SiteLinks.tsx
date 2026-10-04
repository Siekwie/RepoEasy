import { Link } from 'react-router-dom';
import { useApp } from '../context.tsx';

export const SOURCE_URL = 'https://github.com/Siekwie/RepoEasy';

/** Footer links: the source code, the operator's own links, and the legal pages when this instance has an operator. */
export function SiteLinks() {
  const { info } = useApp();
  return (
    <nav className="site-links" aria-label="About this site">
      <a href={SOURCE_URL} target="_blank" rel="noreferrer">
        Source code
      </a>
      {info.links.map((l) => (
        <a key={l.url} href={l.url} target="_blank" rel="noreferrer me">
          {l.label}
        </a>
      ))}
      {info.operator && (
        <>
          <Link to="/imprint">Imprint</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
        </>
      )}
    </nav>
  );
}
