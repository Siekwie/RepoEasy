import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminStats } from './admin.ts';
import { config, VERSION } from './config.ts';
import { openDbReadOnly, type DB } from './db.ts';

// The owner's admin interface: accounts, usage and the visit funnel. It is its own listener,
// started on its own (`node dist/admin.mjs`, the repoeasy-admin container) and never put behind
// the proxy. The public site has no admin page and no admin endpoint.
//
// It has no login. What protects it instead:
//   - It listens only where the owner can reach it: 127.0.0.1 by default. In Docker the port is
//     published on the server's loopback and opened from the owner's PC through an SSH tunnel.
//   - It answers only requests addressed to localhost (the Host header), so a web page that
//     points its own domain at 127.0.0.1 (DNS rebinding) gets nothing.
//   - It only reads: GET and HEAD, on a read-only database connection. An action added here
//     later needs a per-start token in its form and an Origin check before it changes anything.

/** localhost, 127.0.0.1 or [::1] with any port: what a browser sends through the SSH tunnel. */
export function isLocalHost(host: string | undefined): boolean {
  return host !== undefined && /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i.test(host);
}

const PAGE_CSP = [
  `default-src 'self'`,
  `script-src 'self'`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: https://avatars.githubusercontent.com https://*.githubusercontent.com`,
  `connect-src 'self'`,
  `frame-ancestors 'none'`,
  `base-uri 'self'`,
  `form-action 'none'`,
].join('; ');

export function createAdminApp(db: DB, webDir = config.admin.webDir) {
  const app = new Hono();

  app.onError((err, c) => {
    console.error('[admin]', err);
    return c.text('Something went wrong. The details are in the log: docker logs repoeasy-admin\n', 500);
  });

  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('Referrer-Policy', 'same-origin');
    c.header('X-Robots-Tag', 'noindex, nofollow');
    if (!c.req.path.startsWith('/assets/')) c.header('Cache-Control', 'no-store');
    if (c.res.headers.get('content-type')?.startsWith('text/html')) c.header('Content-Security-Policy', PAGE_CSP);
  });

  app.use('*', async (c, next) => {
    if (!isLocalHost(c.req.header('host'))) {
      return c.text(`The RepoEasy admin interface only answers on localhost. Open it through the SSH tunnel, e.g. http://localhost:${config.admin.port}/\n`, 403);
    }
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return c.text('Method not allowed\n', 405, { Allow: 'GET, HEAD' });
    await next();
  });

  app.get('/healthz', (c) => {
    db.prepare('SELECT 1').get();
    return c.text('ok');
  });

  app.get('/api/admin/stats', (c) => c.json(adminStats(db)));

  // The built admin page (npm run build:admin).
  if (existsSync(join(webDir, 'index.html'))) {
    app.use('/assets/*', async (c, next) => {
      await next();
      if (c.res.status === 200) c.header('Cache-Control', 'public, max-age=31536000, immutable');
    });
    // read per request so a rebuilt page is picked up without a restart
    app.get('/', (c) => c.html(readFileSync(join(webDir, 'index.html'), 'utf8')));
    app.use('*', serveStatic({ root: relative(process.cwd(), webDir) || '.' }));
  } else {
    app.get('/', (c) => c.text(`RepoEasy admin ${VERSION} is running, but its page is not built.\nRun "npm run build".\n`));
  }

  app.all('*', (c) => c.text("There's nothing at this address.\n", 404));

  return app;
}

/* ------------------------------------------------------------------ entry point */

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  let db: DB;
  try {
    db = openDbReadOnly(config.dbPath);
  } catch (err) {
    console.error(`[admin] Could not open ${config.dbPath}: ${err instanceof Error ? err.message : err}`);
    console.error('[admin] The database is created by the RepoEasy server on its first start. Start that first.');
    process.exit(1);
  }

  const { host, port } = config.admin;
  const server = serve({ fetch: createAdminApp(db).fetch, port, hostname: host }, (info) => {
    console.log(`RepoEasy admin ${VERSION} on http://${info.address}:${info.port} (no login: this port must stay private)`);
    console.log(`[admin] data: ${config.dbPath} (read-only)`);
  });

  const shutdown = () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
