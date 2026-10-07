import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type {
  ApiError,
  ApiToken,
  ApiTokenCreated,
  AppInfo,
  BadgeMetric,
  RepoGithubPatch,
  RepoPatch,
  UserSettings,
} from '../shared/api.ts';
import { parseRepoName } from '../shared/repo-input.ts';
import { BADGE_METRICS, badgeSvg, repoBadge } from './badges.ts';
import { applyStripeEvent, cancelSubscription, checkoutUrl, portalUrl, verifyStripeSignature } from './billing.ts';
import { config, effectivePlan, planLimits, VERSION } from './config.ts';
import { randomToken, safeEqual, sha256 } from './crypto.ts';
import { nowIso, type DB, type RepoRow, type UserRow } from './db.ts';
import { Codeberg, fetchCodebergRepo } from './codeberg.ts';
import { checkWebhookUrl } from './events.ts';
import { fetchRepoByName, fetchViewer, GitHub, GitHubError } from './github.ts';
import {
  ApiFail,
  body,
  clientAddress,
  createSession,
  csv,
  currentUser,
  destroySession,
  fail,
  requireUser,
  sameOrigin,
  trustedHost,
  type Env,
} from './http.ts';
import * as q from './queries.ts';
import { collectRepo, repoRecord, saveRepo, syncUser, userSettings } from './sync.ts';
import { accessToken, exchangeCode, upsertUser } from './tokens.ts';
import { hitAllowed, recordVisit, rememberSource, takeSource, visitSource } from './visits.ts';

export interface AppDeps {
  /** GitHub client for a user; replaced in tests. */
  githubFor?: (user: UserRow) => Promise<GitHub>;
  fetchFn?: typeof fetch;
  /** Single-user mode: the account that /auth/local signs in as, once it exists. */
  localUserId?: () => number | null;
}

const OAUTH_STATE_COOKIE = 're_oauth_state';

export function createApp(db: DB, deps: AppDeps = {}) {
  const app = new Hono<Env>();
  const githubFor = deps.githubFor ?? (async (user: UserRow) => new GitHub(await accessToken(db, user, deps.fetchFn)));
  const getUser = (id: number) => db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow;
  /** Single-user sign-in is offered only where a stranger cannot reach it, or behind a password. */
  const localSignIn = Boolean(config.localToken) && (!config.exposed || Boolean(config.appPassword));
  const repoId = (value: string) => {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : fail('not-found', 'Repository not found.');
  };
  const linkOr404 = (userId: number, id: number) => q.getLink(db, userId, id) ?? fail('not-found', 'Repository not found.');
  /** Wraps GitHub (and Codeberg) failures in handler code as a readable API error. */
  const github = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (err) {
      if (err instanceof GitHubError) {
        return fail(err.rateLimited ? 'rate-limited' : 'github-error', `${err.service}: ${err.message}`);
      }
      throw err;
    }
  };

  app.onError((err, c) => {
    if (err instanceof ApiFail) return c.json<ApiError>({ error: err.message, code: err.code }, err.status);
    console.error('[http]', err);
    return c.json<ApiError>({ error: 'Something went wrong on our side.', code: 'internal' }, 500);
  });

  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (!c.req.path.startsWith('/badge/')) c.header('X-Frame-Options', 'DENY');
  });

  const tooLarge = () => fail('bad-request', 'Request body is too large.');
  const smallBody = bodyLimit({ maxSize: 64 * 1024, onError: tooLarge });
  const webhookBody = bodyLimit({ maxSize: 1024 * 1024, onError: tooLarge });
  app.use('/api/*', (c, next) => (c.req.path === '/api/billing/webhook' ? webhookBody(c, next) : smallBody(c, next)));
  app.use('/auth/*', smallBody);
  app.use('/api/*', trustedHost);
  app.use('/auth/*', trustedHost);

  // ---- Stripe webhook (signed by Stripe, so it sits outside the same-origin check) ----

  app.post('/api/billing/webhook', async (c) => {
    const secret = config.billing.stripeWebhookSecret;
    if (!config.billing.enabled || !secret) return fail('not-found', 'Billing is not enabled.');
    const raw = await c.req.text();
    if (!verifyStripeSignature(raw, c.req.header('stripe-signature') ?? '', secret)) {
      return fail('forbidden', 'Invalid signature.');
    }
    applyStripeEvent(db, JSON.parse(raw));
    return c.json({ received: true });
  });

  app.use('/api/*', sameOrigin);
  app.use('/auth/*', sameOrigin);

  // ---- Public ----

  app.get('/healthz', (c) => {
    db.prepare('SELECT 1').get();
    return c.text('ok');
  });

  app.get('/api/info', (c) =>
    c.json<AppInfo>({
      name: 'RepoEasy',
      version: VERSION,
      auth: {
        github: Boolean(config.github.clientId && config.github.clientSecret),
        githubAppInstallUrl: config.github.appSlug
          ? `${config.github.webUrl}/apps/${config.github.appSlug}/installations/new`
          : null,
        local: localSignIn,
        localNeedsPassword: localSignIn && Boolean(config.appPassword),
        demo: config.demo,
      },
      billing: {
        enabled: config.billing.enabled,
        proMonthly: config.billing.displayMonthly,
        proYearly: config.billing.displayYearly,
      },
      limits: { free: planLimits('free'), pro: planLimits('pro') },
      operator:
        config.operator.name && config.operator.address.length
          ? {
              name: config.operator.name,
              address: config.operator.address,
              email: config.operator.email,
              hosting: config.operator.hosting,
              backupDays: Math.ceil((config.backup.intervalHours * config.backup.keep) / 24),
            }
          : null,
      links: config.operator.links,
    }),
  );

  // One landing-page view. The address is only used to cap what one caller can add and is not stored.
  app.post('/api/hit', async (c) => {
    const { ref, referrer } = await body<{ ref: string; referrer: string }>(c);
    const source = visitSource(ref, referrer);
    if (hitAllowed(clientAddress(c))) recordVisit(db, 'landing', source);
    return c.json({ source });
  });

  app.get('/api/public/:owner/:repo', (c) => {
    const stats = q.publicStats(db, c.req.param('owner'), c.req.param('repo'));
    if (!stats) return fail('not-found', 'This repository is not shared.');
    c.header('Cache-Control', 'public, max-age=600');
    return c.json(stats);
  });

  app.get('/badge/:owner/:repo/:file', (c) => {
    const metric = c.req.param('file').replace(/\.svg$/, '') as BadgeMetric;
    const svg = BADGE_METRICS.includes(metric) ? repoBadge(db, c.req.param('owner'), c.req.param('repo'), metric) : null;
    c.header('Content-Type', 'image/svg+xml; charset=utf-8');
    c.header('Cache-Control', svg ? 'public, max-age=3600' : 'no-cache');
    return c.body(svg ?? badgeSvg('RepoEasy', 'not shared', '#6e7781'), svg ? 200 : 404);
  });

  // ---- Auth ----

  app.get('/auth/github', (c) => {
    if (!config.github.clientId) return c.redirect('/?error=github-not-configured');
    const state = randomToken(16);
    setCookie(c, OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: config.baseUrl.startsWith('https://'),
      path: '/auth',
      maxAge: 600,
    });
    const url = new URL(`${config.github.webUrl}/login/oauth/authorize`);
    url.searchParams.set('client_id', config.github.clientId);
    url.searchParams.set('redirect_uri', `${config.baseUrl}/auth/github/callback`);
    url.searchParams.set('scope', config.github.scopes);
    url.searchParams.set('state', state);
    const source = visitSource(c.req.query('src'), null);
    rememberSource(state, source);
    recordVisit(db, 'signin', source);
    return c.redirect(url.toString());
  });

  app.get('/auth/github/callback', async (c) => {
    const expected = getCookie(c, OAUTH_STATE_COOKIE);
    deleteCookie(c, OAUTH_STATE_COOKIE, { path: '/auth' });
    const { code, state } = c.req.query();
    if (!code || !state || !expected || !safeEqual(state, expected)) return c.redirect('/?error=login-failed');
    try {
      const tokens = await exchangeCode(code, deps.fetchFn);
      const profile = await fetchViewer(new GitHub(tokens.accessToken, deps.fetchFn));
      const source = takeSource(state);
      const isNew = !db.prepare('SELECT 1 FROM users WHERE github_id = ?').get(profile.id);
      const userId = upsertUser(db, profile, tokens);
      if (isNew) {
        db.prepare('UPDATE users SET signup_source = ? WHERE id = ?').run(source, userId);
        recordVisit(db, 'signup', source);
      }
      createSession(c, db, userId);
      void syncUser(db, userId, { fetchFn: deps.fetchFn });
      return c.redirect('/');
    } catch (err) {
      console.error('[auth] GitHub login failed:', err instanceof Error ? err.message : err);
      return c.redirect('/?error=login-failed');
    }
  });

  // failed password attempts per client address
  const failedLocalLogins = new Map<string, number[]>();
  app.post('/auth/local', async (c) => {
    if (!config.localToken) return fail('not-found', 'Local sign-in is not enabled.');
    if (!localSignIn) return fail('forbidden', 'This server is reachable from other machines. Set APP_PASSWORD to enable sign-in.');
    if (config.appPassword) {
      const now = Date.now();
      const address = clientAddress(c);
      const failures = (failedLocalLogins.get(address) ?? []).filter((t) => now - t < 10 * 60_000);
      if (failures.length >= 10) return fail('rate-limited', 'Too many attempts. Try again in a few minutes.');
      const { password } = await body<{ password: string }>(c);
      if (typeof password !== 'string' || !safeEqual(sha256(password), sha256(config.appPassword))) {
        if (failedLocalLogins.size > 10_000) failedLocalLogins.clear();
        failedLocalLogins.set(address, [...failures, now]);
        return fail('unauthorized', 'Wrong password.');
      }
    }
    const userId = deps.localUserId?.() ?? null;
    if (userId === null) return fail('internal', 'The local account is not ready yet. Check the server log for a GitHub token error.');
    createSession(c, db, userId);
    return c.json({ ok: true });
  });

  app.post('/auth/demo', async (c) => {
    const demo = db.prepare('SELECT id FROM users WHERE is_demo = 1 LIMIT 1').get() as { id: number } | undefined;
    if (!config.demo || !demo) return fail('not-found', 'The demo is not enabled.');
    const sent = (await c.req.json().catch(() => null)) as { src?: unknown } | null;
    recordVisit(db, 'demo', visitSource(sent?.src, null));
    // anyone can call this, so demo sessions are short-lived and capped
    db.prepare(
      'DELETE FROM sessions WHERE user_id = ? AND id NOT IN (SELECT id FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 2000)',
    ).run(demo.id, demo.id);
    createSession(c, db, demo.id, 1);
    return c.json({ ok: true });
  });

  app.post('/auth/logout', (c) => {
    destroySession(c, db);
    return c.json({ ok: true });
  });

  // ---- Everything below needs a signed-in user ----

  const auth = requireUser(db);
  app.use('/api/*', auth);

  app.get('/api/me', (c) => c.json(q.me(db, c.var.user)));

  app.patch('/api/me/settings', async (c) => {
    const user = c.var.user;
    const patch = await body<UserSettings>(c);
    const settings = userSettings(user);
    if (patch.webhookUrl !== undefined) {
      const url = typeof patch.webhookUrl === 'string' ? patch.webhookUrl.trim() : '';
      if (url) {
        if (!planLimits(effectivePlan(user)).webhooks) return fail('plan-limit', 'Webhook alerts are part of the Pro plan.');
        const problem = await checkWebhookUrl(url);
        if (problem) return fail('bad-request', problem);
      }
      settings.webhookUrl = url || null;
    }
    for (const key of ['notifyMilestones', 'notifySpikes', 'notifyReleases', 'autoTrackNew'] as const) {
      if (typeof patch[key] === 'boolean') settings[key] = patch[key];
    }
    db.prepare('UPDATE users SET settings_json = ? WHERE id = ?').run(JSON.stringify(settings), user.id);
    return c.json(q.me(db, getUser(user.id)));
  });

  app.delete('/api/me', async (c) => {
    if (config.billing.enabled && c.var.user.stripe_subscription_id) {
      try {
        await cancelSubscription(c.var.user, deps.fetchFn);
      } catch (err) {
        console.error('[billing] cancel on account deletion failed:', err instanceof Error ? err.message : err);
        return fail('internal', 'Your subscription could not be cancelled, so the account was not deleted. Cancel it under "Manage subscription" and try again.');
      }
    }
    db.transaction(() => {
      db.prepare('DELETE FROM users WHERE id = ?').run(c.var.user.id);
      // history of repos nobody else is linked to goes with the account
      db.prepare('DELETE FROM repos WHERE id NOT IN (SELECT repo_id FROM user_repos)').run();
    })();
    destroySession(c, db);
    return c.json({ ok: true });
  });

  app.get('/api/sync', (c) => c.json(q.syncStatus(c.var.user)));

  app.post('/api/sync', (c) => {
    const user = c.var.user;
    const status = q.syncStatus(user);
    if (!status.running) {
      const sinceLast = user.last_sync_started_at ? Date.now() - Date.parse(user.last_sync_started_at) : Infinity;
      const cooldown = config.sync.manualCooldownMinutes * 60_000;
      if (sinceLast < cooldown) {
        return fail('rate-limited', `Synced moments ago. Try again in ${Math.ceil((cooldown - sinceLast) / 60_000)} min.`);
      }
      void syncUser(db, user.id, { fetchFn: deps.fetchFn });
    }
    return c.json(q.syncStatus(getUser(user.id)));
  });

  app.get('/api/overview', (c) => c.json(q.overview(db, c.var.user.id, q.parseRange(c.req.query('range')))));

  app.get('/api/repos', (c) => c.json(q.repoSummaries(db, c.var.user.id)));

  app.post('/api/repos/follow', async (c) => {
    const user = c.var.user;
    const { fullName } = await body<{ fullName: string }>(c);
    const parsed = typeof fullName === 'string' ? parseRepoName(fullName) : null;
    if (!parsed) return fail('bad-request', 'Enter a repository as owner/name, or paste its GitHub or Codeberg URL.');

    // Codeberg is read without the user's GitHub token
    const onCodeberg = parsed.host === 'codeberg';
    const client = onCodeberg ? new Codeberg(deps.fetchFn) : await github(() => githubFor(user));
    const found = await github(async () => {
      if (client instanceof Codeberg) return fetchCodebergRepo(client, parsed.owner, parsed.name);
      const node = await fetchRepoByName(client, parsed.owner, parsed.name);
      return node && repoRecord(node);
    });
    if (!found) return fail('not-found', `${parsed.owner}/${parsed.name} was not found on ${onCodeberg ? 'Codeberg' : 'GitHub'}.`);
    if (found.private) return fail('bad-request', 'Only public repositories can be followed.');

    const existing = db
      .prepare(
        `SELECT ur.relation, ur.gone FROM user_repos ur JOIN repos r ON r.id = ur.repo_id
         WHERE ur.user_id = ? AND r.github_id = ?`,
      )
      .get(user.id, found.github_id) as { relation: string; gone: number } | undefined;
    if (existing && !existing.gone && existing.relation !== 'followed') {
      return fail('bad-request', `${found.full_name} is already one of your repositories.`);
    }
    const alreadyFollowing = Boolean(existing && !existing.gone);
    const max = planLimits(effectivePlan(user)).followedRepos;
    // checked before anything is written, so a refused request leaves no rows behind
    if (!alreadyFollowing && max !== null && q.me(db, user).usage.followed >= max) {
      return fail('plan-limit', `Your plan follows up to ${max} repositories.`);
    }
    const id = saveRepo(db, found);
    if (alreadyFollowing) return c.json(q.repoSummaries(db, user.id, id)[0]);
    db.prepare(
      `INSERT INTO user_repos (user_id, repo_id, relation, added_at) VALUES (?, ?, 'followed', ?)
       ON CONFLICT(user_id, repo_id) DO UPDATE SET relation = 'followed', gone = 0, tracked = 0, can_push = 0, can_admin = 0`,
    ).run(user.id, id, nowIso());
    // releases, commits and star history arrive in the background
    const repo = db.prepare('SELECT * FROM repos WHERE id = ?').get(id) as RepoRow;
    void collectRepo(db, client, repo, false).catch((err) => console.warn(`[follow] ${repo.full_name}: ${err.message}`));
    return c.json(q.repoSummaries(db, user.id, id)[0], 201);
  });

  app.delete('/api/repos/:id/follow', (c) => {
    const id = repoId(c.req.param('id'));
    const result = db.prepare(`DELETE FROM user_repos WHERE user_id = ? AND repo_id = ? AND relation = 'followed'`).run(c.var.user.id, id);
    if (!result.changes) return fail('not-found', 'You are not following that repository.');
    db.prepare('DELETE FROM repos WHERE id = ? AND id NOT IN (SELECT repo_id FROM user_repos)').run(id);
    return c.json({ ok: true });
  });

  app.patch('/api/repos/:id', async (c) => {
    const user = c.var.user;
    const id = repoId(c.req.param('id'));
    const link = linkOr404(user.id, id);
    const patch = await body<RepoPatch>(c);
    const limits = planLimits(effectivePlan(user));
    const set: string[] = [];
    const values: unknown[] = [];
    let startTracking = false;

    if (typeof patch.tracked === 'boolean' && patch.tracked !== Boolean(link.tracked)) {
      if (patch.tracked) {
        if (link.relation === 'followed' || !link.can_push) {
          return fail('bad-request', 'Traffic can only be archived for repositories you have push access to.');
        }
        if (limits.trackedRepos !== null && q.me(db, user).usage.tracked >= limits.trackedRepos) {
          return fail('plan-limit', `Your plan tracks up to ${limits.trackedRepos} repositories. Upgrade to track more.`);
        }
        startTracking = true;
      }
      set.push('tracked = ?');
      values.push(patch.tracked ? 1 : 0);
    }
    if (typeof patch.pinned === 'boolean') {
      set.push('pinned = ?');
      values.push(patch.pinned ? 1 : 0);
    }
    if (typeof patch.hidden === 'boolean') {
      set.push('hidden = ?');
      values.push(patch.hidden ? 1 : 0);
    }
    if (patch.tags !== undefined) {
      if (!Array.isArray(patch.tags) || patch.tags.some((t) => typeof t !== 'string')) return fail('bad-request', 'Tags must be a list of strings.');
      const tags = [...new Set(patch.tags.map((t) => t.trim().slice(0, 30)).filter(Boolean))].slice(0, 12);
      set.push('tags_json = ?');
      values.push(JSON.stringify(tags));
    }
    if (patch.note !== undefined) {
      if (patch.note !== null && typeof patch.note !== 'string') return fail('bad-request', 'Note must be text.');
      set.push('note = ?');
      values.push(patch.note?.trim().slice(0, 4000) || null);
    }
    if (typeof patch.shareEnabled === 'boolean') {
      if (!link.can_admin || link.relation === 'followed') return fail('forbidden', 'Only repository admins can change sharing.');
      if (patch.shareEnabled && link.private) return fail('bad-request', 'Private repositories cannot be shared publicly.');
      if (patch.shareEnabled && !limits.sharePages) return fail('plan-limit', 'Public share pages and badges are part of the Pro plan.');
      db.prepare('UPDATE repos SET share_enabled = ? WHERE id = ?').run(patch.shareEnabled ? 1 : 0, id);
    }
    if (set.length) db.prepare(`UPDATE user_repos SET ${set.join(', ')} WHERE user_id = ? AND repo_id = ?`).run(...values, user.id, id);

    if (startTracking) {
      // collect right away so the page is not empty until the next scheduled sync
      void githubFor(user)
        .then((gh) => collectRepo(db, gh, link, true))
        .catch((err) => console.warn(`[track] ${link.full_name}: ${err.message}`));
    }
    return c.json(q.repoSummaries(db, user.id, id)[0]);
  });

  app.patch('/api/repos/:id/github', async (c) => {
    const user = c.var.user;
    const id = repoId(c.req.param('id'));
    const link = linkOr404(user.id, id);
    if (!link.can_push || link.relation === 'followed') return fail('forbidden', 'You need write access to edit this repository.');
    const patch = await body<RepoGithubPatch>(c);
    const edit: { description?: string; homepage?: string } = {};
    if (patch.description !== undefined) {
      if (typeof patch.description !== 'string') return fail('bad-request', 'Description must be text.');
      edit.description = patch.description.trim().slice(0, 350);
    }
    if (patch.homepage !== undefined) {
      if (typeof patch.homepage !== 'string' || (patch.homepage && !/^https?:\/\//i.test(patch.homepage.trim()))) {
        return fail('bad-request', 'Homepage must be an http(s) URL.');
      }
      edit.homepage = patch.homepage.trim().slice(0, 255);
    }
    let topics: string[] | undefined;
    if (patch.topics !== undefined) {
      if (!Array.isArray(patch.topics)) return fail('bad-request', 'Topics must be a list.');
      topics = [...new Set(patch.topics.map((t) => String(t).trim().toLowerCase()))].filter(Boolean);
      if (topics.length > 20 || topics.some((t) => !/^[a-z0-9][a-z0-9-]{0,49}$/.test(t))) {
        return fail('bad-request', 'Up to 20 topics; lowercase letters, numbers and hyphens only.');
      }
    }

    const gh = await github(() => githubFor(user));
    await github(async () => {
      const path = `/repos/${link.owner}/${link.name}`;
      if (Object.keys(edit).length) await gh.rest(path, { method: 'PATCH', body: edit });
      if (topics) await gh.rest(`${path}/topics`, { method: 'PUT', body: { names: topics } });
    });
    db.prepare(
      'UPDATE repos SET description = COALESCE(?, description), homepage = COALESCE(?, homepage), topics_json = COALESCE(?, topics_json) WHERE id = ?',
    ).run(edit.description ?? null, edit.homepage ?? null, topics ? JSON.stringify(topics) : null, id);
    if (edit.description === '') db.prepare('UPDATE repos SET description = NULL WHERE id = ?').run(id);
    if (edit.homepage === '') db.prepare('UPDATE repos SET homepage = NULL WHERE id = ?').run(id);
    return c.json(q.repoSummaries(db, user.id, id)[0]);
  });

  app.get('/api/repos/:id', (c) => {
    const detail = q.repoDetail(db, c.var.user.id, repoId(c.req.param('id')));
    return detail ? c.json(detail) : fail('not-found', 'Repository not found.');
  });

  /** The repo, provided the caller may see its traffic. */
  const trafficRepo = (userId: number, id: number) => {
    const link = linkOr404(userId, id);
    return link.can_push && link.relation !== 'followed' ? link : null;
  };
  const popularRange = (value: string | undefined) => (value === 'all' ? 'all' : '14d');

  app.get('/api/repos/:id/traffic', (c) => {
    const id = repoId(c.req.param('id'));
    const range = q.parseRange(c.req.query('range'));
    // followed repos have no traffic: an empty set keeps the response shape
    const set = trafficRepo(c.var.user.id, id) ? q.oneRepo(id) : q.oneRepo(-1);
    return c.json(q.trafficSeries(db, set, range));
  });

  app.get('/api/repos/:id/metrics', (c) => {
    const id = repoId(c.req.param('id'));
    linkOr404(c.var.user.id, id);
    return c.json(q.metricSeries(db, id, q.parseRange(c.req.query('range'))));
  });

  app.get('/api/repos/:id/referrers', (c) => {
    const id = repoId(c.req.param('id'));
    const set = trafficRepo(c.var.user.id, id) ? q.oneRepo(id) : q.oneRepo(-1);
    return c.json(q.referrers(db, set, popularRange(c.req.query('range'))));
  });

  app.get('/api/repos/:id/paths', (c) => {
    const id = repoId(c.req.param('id'));
    const set = trafficRepo(c.var.user.id, id) ? q.oneRepo(id) : q.oneRepo(-1);
    return c.json(q.paths(db, set, popularRange(c.req.query('range'))));
  });

  const limitParam = (value: string | undefined, fallback: number, max: number) => {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? Math.min(n, max) : fallback;
  };

  app.get('/api/repos/:id/commits', (c) => {
    const id = repoId(c.req.param('id'));
    linkOr404(c.var.user.id, id);
    return c.json(q.commits(db, q.oneRepo(id), limitParam(c.req.query('limit'), 30, 500)));
  });

  app.get('/api/commits', (c) => c.json(q.commits(db, q.ownRepos(c.var.user.id), limitParam(c.req.query('limit'), 50, 500))));

  app.get('/api/events', (c) => c.json(q.events(db, c.var.user.id, limitParam(c.req.query('limit'), 30, 500))));

  // ---- Export ----

  app.get('/api/repos/:id/export.csv', (c) => {
    const id = repoId(c.req.param('id'));
    const link = linkOr404(c.var.user.id, id);
    const kind = c.req.query('kind') ?? 'traffic';
    const all = <T>(sql: string) => db.prepare(sql).raw().all(id) as T[];
    type Row = Array<string | number | null>;
    let text: string;
    if (kind === 'metrics') {
      text = csv(
        ['day', 'stars', 'forks', 'watchers', 'open_issues', 'open_prs', 'release_downloads'],
        all<Row>('SELECT day, stars, forks, watchers, open_issues, open_prs, release_downloads FROM metrics_daily WHERE repo_id = ? ORDER BY day'),
      );
    } else if (!trafficRepo(c.var.user.id, id)) {
      return fail('forbidden', 'Traffic data needs push access to the repository.');
    } else if (kind === 'traffic') {
      text = csv(
        ['day', 'views', 'unique_visitors', 'clones', 'unique_cloners'],
        all<Row>('SELECT day, views, uniques, clones, clone_uniques FROM traffic_daily WHERE repo_id = ? ORDER BY day'),
      );
    } else if (kind === 'referrers') {
      text = csv(
        ['snapshot_day', 'referrer', 'views_14d', 'uniques_14d'],
        all<Row>('SELECT day, referrer, count, uniques FROM referrers_snap WHERE repo_id = ? ORDER BY day, count DESC'),
      );
    } else if (kind === 'paths') {
      text = csv(
        ['snapshot_day', 'path', 'title', 'views_14d', 'uniques_14d'],
        all<Row>('SELECT day, path, title, count, uniques FROM paths_snap WHERE repo_id = ? ORDER BY day, count DESC'),
      );
    } else {
      return fail('bad-request', 'kind must be traffic, metrics, referrers or paths.');
    }
    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="${link.owner}-${link.name}-${kind}.csv"`);
    return c.body(text);
  });

  app.get('/api/export.json', (c) => {
    const user = c.var.user;
    const repos = q.repoSummaries(db, user.id).map((repo) => {
      const traffic = repo.trafficLifetime !== null;
      const rows = (sql: string) => db.prepare(sql).all(repo.id);
      return {
        ...repo,
        traffic: traffic ? rows('SELECT day, views, uniques, clones, clone_uniques AS cloneUniques FROM traffic_daily WHERE repo_id = ? ORDER BY day') : [],
        referrerSnapshots: traffic ? rows('SELECT day, referrer, count, uniques FROM referrers_snap WHERE repo_id = ? ORDER BY day') : [],
        pathSnapshots: traffic ? rows('SELECT day, path, title, count, uniques FROM paths_snap WHERE repo_id = ? ORDER BY day') : [],
        metrics: rows('SELECT day, stars, forks, watchers, open_issues AS openIssues, open_prs AS openPrs, release_downloads AS releaseDownloads FROM metrics_daily WHERE repo_id = ? ORDER BY day'),
        starHistory: rows('SELECT day, new_stars AS newStars FROM star_history WHERE repo_id = ? ORDER BY day'),
        releases: q.releasesOf(db, repo.id),
      };
    });
    c.header('Content-Disposition', `attachment; filename="repoeasy-${user.login}-${nowIso().slice(0, 10)}.json"`);
    return c.json({
      exportedAt: nowIso(),
      account: { login: user.login, name: user.name, createdAt: user.created_at, settings: userSettings(user) },
      repos,
      events: q.events(db, user.id, 500),
    });
  });

  // ---- API tokens ----

  const tokenRow = (t: { id: number; name: string; prefix: string; created_at: string; last_used_at: string | null }): ApiToken => ({
    id: t.id,
    name: t.name,
    prefix: t.prefix,
    createdAt: t.created_at,
    lastUsedAt: t.last_used_at,
  });

  app.get('/api/tokens', (c) =>
    c.json(
      (db.prepare('SELECT * FROM api_tokens WHERE user_id = ? ORDER BY id DESC').all(c.var.user.id) as Array<Parameters<typeof tokenRow>[0]>).map(tokenRow),
    ),
  );

  app.post('/api/tokens', async (c) => {
    const user = c.var.user;
    if (c.var.viaToken) return fail('forbidden', 'API tokens cannot create other tokens.');
    if (!planLimits(effectivePlan(user)).apiTokens) return fail('plan-limit', 'API access is part of the Pro plan.');
    const { name } = await body<{ name: string }>(c);
    const label = typeof name === 'string' && name.trim() ? name.trim().slice(0, 60) : 'API token';
    const count = (db.prepare('SELECT COUNT(*) n FROM api_tokens WHERE user_id = ?').get(user.id) as { n: number }).n;
    if (count >= 20) return fail('bad-request', 'Delete an unused token first (20 max).');
    const token = `re_${randomToken(30)}`;
    const prefix = `${token.slice(0, 8)}…`;
    const row = db
      .prepare('INSERT INTO api_tokens (user_id, name, token_hash, prefix, created_at) VALUES (?, ?, ?, ?, ?) RETURNING *')
      .get(user.id, label, sha256(token), prefix, nowIso()) as Parameters<typeof tokenRow>[0];
    return c.json<ApiTokenCreated>({ ...tokenRow(row), token }, 201);
  });

  app.delete('/api/tokens/:id', (c) => {
    const result = db.prepare('DELETE FROM api_tokens WHERE id = ? AND user_id = ?').run(Number(c.req.param('id')), c.var.user.id);
    return result.changes ? c.json({ ok: true }) : fail('not-found', 'Token not found.');
  });

  // ---- Billing ----

  app.post('/api/billing/checkout', async (c) => {
    if (!config.billing.enabled) return fail('not-found', 'Billing is not enabled on this instance.');
    const { interval } = await body<{ interval: string }>(c);
    try {
      return c.json({ url: await checkoutUrl(c.var.user, interval === 'year' ? 'year' : 'month', deps.fetchFn) });
    } catch (err) {
      return fail('bad-request', err instanceof Error ? err.message : 'Could not start checkout.');
    }
  });

  app.post('/api/billing/portal', async (c) => {
    if (!config.billing.enabled) return fail('not-found', 'Billing is not enabled on this instance.');
    try {
      return c.json({ url: await portalUrl(c.var.user, deps.fetchFn) });
    } catch (err) {
      return fail('bad-request', err instanceof Error ? err.message : 'Could not open the billing portal.');
    }
  });

  app.all('/api/*', () => fail('not-found', 'Unknown API endpoint.'));

  return app;
}

export { currentUser };
