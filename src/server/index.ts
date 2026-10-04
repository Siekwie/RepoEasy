import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createApp } from './app.ts';
import { config, VERSION } from './config.ts';
import { openDb } from './db.ts';
import { seedDemo } from './demo.ts';
import { fetchViewer, GitHub } from './github.ts';
import { startScheduler } from './scheduler.ts';
import { syncUser } from './sync.ts';
import { upsertUser } from './tokens.ts';

const db = openDb(config.dbPath);
let localUserId: number | null = null;
const app = createApp(db, { localUserId: () => localUserId });

// The built web app. API, auth and badge routes are registered first and win.
if (existsSync(join(config.webDir, 'index.html'))) {
  const root = relative(process.cwd(), config.webDir) || '.';
  app.use('/assets/*', async (c, next) => {
    await next();
    if (c.res.status === 200) c.header('Cache-Control', 'public, max-age=31536000, immutable');
  });
  // index.html is read per request so a rebuilt web app is picked up without a restart
  const page = () => readFileSync(join(config.webDir, 'index.html'), 'utf8');
  const contentSecurityPolicy = (html: string) => {
    // the page's own inline scripts (theme bootstrap) are allowed by hash, nothing else inline is
    const inline = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
      (m) => `'sha256-${createHash('sha256').update(m[1]!).digest('base64')}'`,
    );
    return [
      `default-src 'self'`,
      `script-src 'self' ${inline.join(' ')}`.trim(),
      `style-src 'self' 'unsafe-inline'`,
      `img-src 'self' data: ${new URL(config.baseUrl).origin} https://avatars.githubusercontent.com https://*.githubusercontent.com`,
      `connect-src 'self'`,
      `frame-ancestors 'none'`,
      `base-uri 'self'`,
      `form-action 'self'`,
    ].join('; ');
  };
  app.use('*', async (c, next) => {
    await next();
    if (c.res.headers.get('content-type')?.startsWith('text/html')) {
      c.header('Content-Security-Policy', contentSecurityPolicy(page()));
    }
  });
  app.use('*', serveStatic({ root }));
  // a missing hashed asset must be a 404, never the app shell cached as that asset
  app.get('/assets/*', (c) => c.notFound());
  app.get('*', (c) => c.html(page()));
} else {
  app.get('*', (c) =>
    c.text(`RepoEasy API ${VERSION} is running, but the web app is not built.\nRun "npm run build" (or "npm run dev" and open http://localhost:5173).`),
  );
}

if (config.demo) seedDemo(db);

/** Single-user mode: the account behind GITHUB_TOKEN is created at startup. */
async function setupLocalUser(token: string): Promise<void> {
  try {
    const profile = await fetchViewer(new GitHub(token));
    localUserId = upsertUser(db, profile, { accessToken: token, refreshToken: null, expiresAt: null });
    console.log(`[local] single-user mode for @${profile.login}`);
    if (!config.sync.disabled) void syncUser(db, localUserId);
  } catch (err) {
    console.error(`[local] GITHUB_TOKEN could not be used: ${err instanceof Error ? err.message : err}`);
    // GitHub unreachable or token expired: the archive is still worth looking at
    const known = db.prepare('SELECT id FROM users WHERE is_demo = 0').all() as Array<{ id: number }>;
    if (known.length === 1) localUserId = known[0]!.id;
  }
}
if (config.localToken) {
  void setupLocalUser(config.localToken);
  if (config.exposed && !config.appPassword) {
    console.warn('[local] This server is reachable from other machines (HOST or BASE_URL is not local). Sign-in stays disabled until APP_PASSWORD is set.');
  }
} else if (process.env.GITHUB_TOKEN && config.multiUser) {
  console.warn('[local] GITHUB_TOKEN is ignored because GitHub sign-in or billing is configured.');
}

const stopScheduler = config.sync.disabled ? () => {} : startScheduler(db);

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`RepoEasy ${VERSION} listening on http://${info.address}:${info.port} (public URL ${config.baseUrl})`);
});

const shutdown = () => {
  stopScheduler();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
