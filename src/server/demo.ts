import { addDays, dayOf, nowIso, type DB } from './db.ts';
import { recordEvent } from './events.ts';

// Sample account for the "Try the live demo" button and for UI work without a GitHub token.
// All data is synthetic and deterministic.

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface DemoRepo {
  name: string;
  owner?: string;
  description: string | null;
  language: [string, string];
  topics: string[];
  license: string | null;
  private?: boolean;
  followed?: boolean;
  archived?: boolean;
  stars: number;
  /** Average views per day at the end of the series. */
  traffic: number;
  ageDays: number;
  releases: number;
  ci?: string | null;
  spikeDaysAgo?: number;
}

const REPOS: DemoRepo[] = [
  { name: 'tinycache', description: 'A zero-dependency LRU cache with TTL for Node and the browser', language: ['TypeScript', '#3178c6'], topics: ['cache', 'lru', 'typescript'], license: 'MIT', stars: 1284, traffic: 310, ageDays: 540, releases: 14, ci: 'SUCCESS', spikeDaysAgo: 38 },
  { name: 'pgdiff', description: 'Schema diff and migration generator for PostgreSQL', language: ['Go', '#00ADD8'], topics: ['postgres', 'migrations', 'cli'], license: 'Apache-2.0', stars: 462, traffic: 120, ageDays: 400, releases: 9, ci: 'SUCCESS', spikeDaysAgo: 11 },
  { name: 'dotfiles', description: 'My shell, editor and terminal setup', language: ['Shell', '#89e051'], topics: [], license: null, stars: 37, traffic: 14, ageDays: 900, releases: 0, ci: null },
  { name: 'markdown-slides', description: 'Turn a Markdown file into a slide deck', language: ['JavaScript', '#f1e05a'], topics: ['markdown', 'slides'], license: 'MIT', stars: 211, traffic: 55, ageDays: 300, releases: 5, ci: 'FAILURE' },
  { name: 'billing-service', description: 'Internal invoicing API', language: ['Python', '#3572A5'], topics: [], license: null, private: true, stars: 0, traffic: 9, ageDays: 220, releases: 0, ci: 'SUCCESS' },
  { name: 'old-blog', description: null, language: ['HTML', '#e34c26'], topics: [], license: null, archived: true, stars: 3, traffic: 2, ageDays: 1500, releases: 0, ci: null },
  { name: 'react', owner: 'facebook', description: 'The library for web and native user interfaces.', language: ['JavaScript', '#f1e05a'], topics: ['react', 'ui', 'frontend'], license: 'MIT', followed: true, stars: 241_300, traffic: 0, ageDays: 4500, releases: 120, ci: 'SUCCESS' },
  { name: 'ripgrep', owner: 'BurntSushi', description: 'ripgrep recursively searches directories for a regex pattern', language: ['Rust', '#dea584'], topics: ['cli', 'search', 'rust'], license: 'Unlicense', followed: true, stars: 58_900, traffic: 0, ageDays: 3700, releases: 60, ci: 'SUCCESS' },
  { name: 'htmx', owner: 'bigskysoftware', description: 'High power tools for HTML', language: ['JavaScript', '#f1e05a'], topics: ['html', 'hypermedia'], license: '0BSD', followed: true, stars: 46_200, traffic: 0, ageDays: 2300, releases: 45, ci: 'SUCCESS' },
];

const REFERRERS = ['github.com', 'Google', 'news.ycombinator.com', 'reddit.com', 'dev.to', 'twitter.com', 'duckduckgo.com', 'lobste.rs'];
const MESSAGES = ['Fix edge case in eviction order', 'Add benchmarks', 'Update dependencies', 'Document TTL option', 'Refactor parser', 'Handle empty input', 'Bump version', 'Improve error messages', 'Add CI workflow', 'Tidy README'];

const DEMO_LOGIN = 'octo-demo';

/** Creates the demo account once; refreshes nothing if it already exists and is current. */
export function seedDemo(db: DB): void {
  const today = dayOf();
  const existing = db.prepare('SELECT id, last_sync_at FROM users WHERE is_demo = 1').get() as { id: number; last_sync_at: string | null } | undefined;
  if (existing?.last_sync_at?.slice(0, 10) === today) return;

  db.transaction(() => {
    if (existing) {
      db.prepare('DELETE FROM users WHERE id = ?').run(existing.id);
      db.prepare('DELETE FROM repos WHERE github_id < 0').run();
    }
    const now = nowIso();
    const userId = Number(
      db
        .prepare(
          `INSERT INTO users (login, name, avatar_url, is_demo, plan, created_at, last_login_at, last_sync_at)
           VALUES (?, 'Demo account', NULL, 1, 'pro', ?, ?, ?)`,
        )
        .run(DEMO_LOGIN, now, now, now).lastInsertRowid,
    );

    REPOS.forEach((spec, index) => {
      const rand = rng(index + 1);
      const owner = spec.owner ?? DEMO_LOGIN;
      const fullName = `${owner}/${spec.name}`;
      const pushed = new Date(Date.now() - (spec.archived ? 500 : rand() * 6) * 86_400_000).toISOString();
      const languages = [
        { name: spec.language[0], color: spec.language[1], bytes: 180_000 + Math.floor(rand() * 400_000) },
        { name: 'Shell', color: '#89e051', bytes: 4000 + Math.floor(rand() * 9000) },
      ];
      const repoId = Number(
        db
          .prepare(
            `INSERT INTO repos (github_id, owner, name, full_name, html_url, private, archived, description, language, language_color,
               languages_json, topics_json, license, default_branch, has_readme, size_kb, stars, forks, watchers, open_issues, open_prs,
               release_count, commit_count, ci_state, created_at_gh, pushed_at, meta_synced_at, detail_synced_at, star_backfill_done, share_enabled)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'main', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
          )
          .run(
            -(index + 1), owner, spec.name, fullName, `https://github.com/${fullName}`, spec.private ? 1 : 0, spec.archived ? 1 : 0,
            spec.description, spec.language[0], spec.language[1], JSON.stringify(languages), JSON.stringify(spec.topics), spec.license,
            spec.name === 'old-blog' ? 0 : 1, 800 + Math.floor(rand() * 9000), spec.stars, Math.round(spec.stars * 0.07),
            Math.round(spec.stars * 0.02), Math.round(spec.stars * 0.012 + rand() * 4), Math.round(rand() * 5),
            spec.releases, 120 + Math.floor(rand() * 900), spec.ci ?? null,
            new Date(Date.now() - spec.ageDays * 86_400_000).toISOString(), pushed, now, now, index === 0 ? 1 : 0,
          ).lastInsertRowid,
      );
      db.prepare(
        `INSERT INTO user_repos (user_id, repo_id, relation, can_push, can_admin, tracked, pinned, tags_json, note, added_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        userId, repoId, spec.followed ? 'followed' : 'owner', spec.followed ? 0 : 1, spec.followed ? 0 : 1,
        spec.followed || spec.archived ? 0 : 1, index === 0 ? 1 : 0,
        JSON.stringify(index < 2 ? ['oss', 'flagship'] : spec.private ? ['work'] : []),
        index === 0 ? 'Launch post planned for v2.0.' : null,
        new Date(Date.now() - 200 * 86_400_000).toISOString(),
      );

      // Daily metrics: stars grow along an S-curve that ends at the current count.
      const historyDays = Math.min(spec.ageDays, 420);
      const snapshotDays = 200;
      const insertMetric = db.prepare(
        'INSERT INTO metrics_daily (repo_id, day, stars, forks, watchers, open_issues, open_prs, release_downloads) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      );
      const insertStars = db.prepare('INSERT OR REPLACE INTO star_history (repo_id, day, new_stars) VALUES (?, ?, ?)');
      const starsAt = (daysAgo: number) => {
        const progress = 1 - daysAgo / historyDays;
        const growth = spec.followed ? 0.94 + 0.06 * progress : progress ** 1.8;
        return Math.max(0, Math.round(spec.stars * growth));
      };
      const downloadsNow = spec.releases * (400 + Math.floor(rand() * 900));
      for (let ago = historyDays; ago >= 0; ago--) {
        const day = addDays(today, -ago);
        const stars = ago === 0 ? spec.stars : starsAt(ago);
        if (ago > snapshotDays) {
          const added = stars - starsAt(ago + 1);
          if (added > 0) insertStars.run(repoId, day, added);
          continue;
        }
        insertMetric.run(
          repoId, day, stars, Math.round(stars * 0.07), Math.round(stars * 0.02),
          Math.max(0, Math.round(stars * 0.012 + Math.sin(ago / 9) * 3 + 2)), Math.max(0, Math.round(2 + Math.sin(ago / 5) * 2)),
          spec.releases ? Math.round(downloadsNow * (1 - ago / (snapshotDays * 1.4))) : 0,
        );
      }
      db.prepare('UPDATE repos SET release_downloads = ? WHERE id = ?').run(spec.releases ? downloadsNow : 0, repoId);

      const insertRelease = db.prepare(
        `INSERT INTO releases (repo_id, release_id, tag, name, published_at, prerelease, downloads, html_url, assets_json) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      );
      const shown = Math.min(spec.releases, 10);
      for (let i = 0; i < shown; i++) {
        const tag = `v${Math.floor((shown - i) / 4) + 1}.${(shown - i) % 4}.0`;
        const downloads = Math.round((downloadsNow / shown) * (0.5 + rand()));
        insertRelease.run(
          repoId, index * 100 + i, tag, i === 0 ? `${tag} (latest)` : tag, new Date(Date.now() - (i * 24 + 3) * 86_400_000).toISOString(),
          downloads, `https://github.com/${fullName}/releases/tag/${tag}`,
          JSON.stringify([{ name: `${spec.name}-${tag}.tar.gz`, downloads, size: 240_000 }]),
        );
        if (i === 0) {
          db.prepare('UPDATE repos SET latest_release_tag = ?, latest_release_at = ? WHERE id = ?').run(tag, new Date(Date.now() - 3 * 86_400_000).toISOString(), repoId);
        }
      }

      if (spec.followed) return;

      const insertCommit = db.prepare(
        `INSERT OR IGNORE INTO commits (repo_id, sha, message, author_login, author_name, committed_at, html_url) VALUES (?, ?, ?, ?, 'Demo account', ?, ?)`,
      );
      const commitCount = spec.archived ? 6 : 60 + Math.floor(rand() * 120);
      for (let i = 0; i < commitCount; i++) {
        const ago = spec.archived ? 500 + rand() * 300 : rand() ** 1.6 * 360;
        const sha = Array.from({ length: 40 }, () => Math.floor(rand() * 16).toString(16)).join('');
        insertCommit.run(
          repoId, sha, MESSAGES[Math.floor(rand() * MESSAGES.length)], DEMO_LOGIN,
          new Date(Date.now() - ago * 86_400_000).toISOString(), `https://github.com/${fullName}/commit/${sha}`,
        );
      }

      if (spec.archived) return;

      // Traffic: weekday rhythm, slow growth, noise, and an optional launch spike.
      const insertTraffic = db.prepare('INSERT INTO traffic_daily (repo_id, day, views, uniques, clones, clone_uniques) VALUES (?, ?, ?, ?, ?, ?)');
      for (let ago = snapshotDays; ago >= 0; ago--) {
        const day = addDays(today, -ago);
        const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
        const rhythm = weekday === 0 || weekday === 6 ? 0.55 : 1;
        const growth = 0.45 + 0.55 * (1 - ago / snapshotDays);
        const sinceSpike = spec.spikeDaysAgo === undefined ? -1 : spec.spikeDaysAgo - ago;
        const spike = sinceSpike >= 0 && sinceSpike < 6 ? 7 * Math.exp(-sinceSpike / 1.6) : 0;
        const views = Math.round(spec.traffic * rhythm * growth * (0.75 + rand() * 0.5) * (1 + spike) * (ago === 0 ? 0.4 : 1));
        const uniques = Math.round(views * (0.3 + rand() * 0.12));
        const clones = Math.round(views * (0.1 + rand() * 0.06));
        insertTraffic.run(repoId, day, views, uniques, clones, Math.round(clones * (0.5 + rand() * 0.2)));
      }

      const insertReferrer = db.prepare('INSERT INTO referrers_snap (repo_id, day, referrer, count, uniques) VALUES (?, ?, ?, ?, ?)');
      const insertPath = db.prepare('INSERT INTO paths_snap (repo_id, day, path, title, count, uniques) VALUES (?, ?, ?, ?, ?, ?)');
      const pathList = ['', '/issues', '/releases', '/blob/main/README.md', '/pulls', '/tree/main/src', '/wiki'];
      for (let ago = 196; ago >= 0; ago -= 14) {
        const day = addDays(today, -ago);
        const volume = spec.traffic * 14 * (0.45 + 0.55 * (1 - ago / snapshotDays));
        const hot = spec.spikeDaysAgo !== undefined && ago <= spec.spikeDaysAgo && spec.spikeDaysAgo - ago < 14;
        REFERRERS.forEach((referrer, i) => {
          const share = (referrer === 'news.ycombinator.com' ? (hot ? 0.5 : 0.01) : 0.4 / (i + 1.5)) * (0.8 + rand() * 0.4);
          const count = Math.round(volume * share);
          if (count > 0) insertReferrer.run(repoId, day, referrer, count, Math.max(1, Math.round(count * 0.45)));
        });
        pathList.forEach((path, i) => {
          const count = Math.round((volume * 0.5 * (0.8 + rand() * 0.4)) / (i + 1));
          if (count > 0) {
            insertPath.run(repoId, day, `/${fullName}${path}`, path ? `${fullName}${path}` : `${fullName}: ${spec.description ?? ''}`, count, Math.max(1, Math.round(count * 0.4)));
          }
        });
      }
    });

    const repoIdOf = (name: string) => (db.prepare('SELECT id FROM repos WHERE full_name = ? AND github_id < 0').get(name) as { id: number }).id;
    const tinycache = repoIdOf(`${DEMO_LOGIN}/tinycache`);
    const pgdiff = repoIdOf(`${DEMO_LOGIN}/pgdiff`);
    recordEvent(db, userId, { kind: 'star-milestone', repoId: tinycache, title: `${DEMO_LOGIN}/tinycache reached 1,000 stars`, detail: 'Now at 1,284.', url: null, dedupeKey: 'demo:1' });
    recordEvent(db, userId, { kind: 'traffic-spike', repoId: pgdiff, title: `Traffic spike on ${DEMO_LOGIN}/pgdiff`, detail: '1,120 views in one day, 6.8x the 14-day average.', url: null, dedupeKey: 'demo:2' });
    recordEvent(db, userId, { kind: 'referrer-new', repoId: pgdiff, title: `New referrer for ${DEMO_LOGIN}/pgdiff: news.ycombinator.com`, detail: '842 views in the last 14 days.', url: null, dedupeKey: 'demo:3' });
    recordEvent(db, userId, { kind: 'new-release', repoId: repoIdOf('BurntSushi/ripgrep'), title: 'BurntSushi/ripgrep released v3.2.0', url: null, dedupeKey: 'demo:4' });
  })();
}
