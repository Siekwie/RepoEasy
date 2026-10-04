# RepoEasy

GitHub only keeps 14 days of traffic for a repository. RepoEasy signs in with GitHub, archives that
traffic every day, and keeps it for good, so you get lifetime views, visitors, clones, referrers and
popular pages for every repository you can push to, private ones included. It also records stars,
forks, issues, pull requests and release downloads daily, backfills star history from before you
started, and lets you follow any public repository to watch its numbers over time.

One small Node process, one SQLite file. Run it for yourself, or host it for others with plans and
Stripe billing.

## What it does

- **Lifetime traffic.** Daily views, unique visitors, clones and unique cloners, merged from GitHub's
  rolling 14-day window into a permanent per-day archive. Referrers and popular paths are snapshotted
  too, with a lifetime estimate.
- **All your repositories.** Owned, collaborator and organisation repos, public and private, found
  automatically. Choose which ones are tracked.
- **Follow public repositories.** Stars, forks, issues, releases, downloads and commits of any public
  repo, recorded daily. Star history is backfilled to the repo's first star.
- **Overview.** Totals and trends across everything: traffic, stars, top repos, top referrers,
  languages, a commit calendar, and a feed of events (star milestones, traffic spikes, new referrers,
  new releases).
- **Manage.** Tags, private notes, pin and hide, a health checklist per repo (description, README,
  license, topics, stale, failing CI), CI status at a glance, and editing description, homepage and
  topics on GitHub from the same page.
- **Share.** Opt-in public stats page and README badges for public repos (lifetime views, visitors,
  clones, stars, downloads). Private repositories can never be shared.
- **Your data.** CSV export per repo, full JSON export, a read-only JSON API with personal tokens, webhook
  alerts for Discord, Slack or anything that takes a POST, and account deletion that removes the data.

## Run it for yourself

Requires Node 22 or newer.

```bash
npm install
npm run build
```

Create `.env` (see [.env.example](.env.example)) with a GitHub token for your account:

```
GITHUB_TOKEN=<token>
```

A classic token needs the `repo` scope. A fine-grained token needs repository permissions
*Administration: read* and *Metadata: read* (plus *Contents: read* for release downloads). If you use
the GitHub CLI, `gh auth token` prints a token that works.

```bash
npm start
```

Open http://localhost:8787 and sign in. The first sync starts immediately and repeats every 6 hours.
Keep the process running (or start it at least once every two weeks) and no traffic day is lost.

The server listens on 127.0.0.1 only. To reach it from other machines set `HOST=0.0.0.0`, set
`BASE_URL` to the address you open it at, and set an `APP_PASSWORD`: without a password, sign-in is
refused as soon as the server is reachable from elsewhere. Requests for any other hostname than the
one in `BASE_URL` are rejected.

### Docker

```bash
docker compose up -d
```

Uses `.env` and stores the database in the `repoeasy-data` volume.

## Sign in with GitHub (several users)

Create an OAuth App at https://github.com/settings/developers with the callback URL
`<BASE_URL>/auth/github/callback`, then set:

```
BASE_URL=https://stats.example.com
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
```

GitHub offers no read-only scope for private repositories or traffic, so an OAuth App asks for
`repo`. RepoEasy only reads, except when you use "Edit on GitHub". If that scope is more than your
users should grant, register a **GitHub App** instead with repository permissions *Administration:
read*, *Metadata: read* and *Contents: read* (add *Administration: write* only if you want the edit
form to work), use its client ID and secret in the same two variables, and set `GITHUB_APP_SLUG` so
the UI can send users to pick repositories.

GitHub tokens are stored encrypted (AES-256-GCM) with `APP_SECRET`. Set it yourself on a hosted
instance and keep it out of the data directory's backups; if it is left unset, a key is generated
next to the database, which protects against a leaked database file but not a leaked folder.
Once GitHub sign-in is configured, `GITHUB_TOKEN` is ignored.

## Hosting it as a service

Billing switches on when `STRIPE_SECRET_KEY` is set. Create one product with a monthly and a yearly
price in Stripe, put the price IDs in `STRIPE_PRICE_MONTHLY` and `STRIPE_PRICE_YEARLY`, and add a
webhook endpoint at `<BASE_URL>/api/billing/webhook` for `checkout.session.completed` and
`customer.subscription.*` (its signing secret goes in `STRIPE_WEBHOOK_SECRET`).

Default plans, all adjustable through the environment:

| | Free | Pro ($3 / month, $29 / year) |
|---|---|---|
| Tracked repositories (traffic archive) | 3 | unlimited |
| Followed public repositories | 10 | 100 |
| History kept | forever | forever |
| Sync | daily | every 6 hours |
| CSV / JSON export | yes | yes |
| API tokens, webhook alerts, share pages and badges | no | yes |

Without billing every account has everything. `ADMIN_LOGINS` (GitHub logins or, better, numeric
user ids) unlocks everything for those accounts on a hosted instance. `DEMO=1` adds a read-only demo account with sample data to the sign-in page.

Cost: a sync is about one GraphQL call per 15 repositories plus four to six REST calls per tracked
repository, all made with the user's own GitHub token and rate limit, one account at a time. The
server itself only needs a small VPS and a disk for the SQLite file. Back up `DATA_DIR`; it holds the
only copy of the archived history.

## API

Every read endpoint the web app uses is available with `Authorization: Bearer re_...` (create tokens
under Settings). Tokens are read-only: they cannot change settings, edit repositories or delete
anything. The full list with types is in [src/shared/api.ts](src/shared/api.ts).

```bash
curl -H "Authorization: Bearer re_..." https://stats.example.com/api/repos
```

## Development

```bash
npm run dev        # API on :8787 and Vite on :5173
npm test
npm run typecheck
```

Setting `DEMO=1` and `SYNC_DISABLED=1` in `.env` gives a server with sample data and no GitHub access.

- `src/server` – Hono app, GitHub client, sync engine, scheduler, SQLite schema and queries
- `src/web` – React single-page app with hand-drawn SVG charts, no UI framework
- `src/shared/api.ts` – the API contract both sides compile against
- `test` – the sync engine and HTTP API against an in-memory fake GitHub

## How the numbers are built

- Views and clones are stored per repository per UTC day. Each sync merges GitHub's last 14 days in
  and never lowers a stored day, so partial "today" values are corrected by later syncs.
- "Unique visitors" over a period is the sum of daily uniques; GitHub does not report uniques across
  days, so someone who visits on three days counts three times.
- Referrers and paths exist only as 14-day totals. Lifetime figures add up snapshots taken 14 days
  apart, which covers the archived period without counting a visit twice.
- Stars before tracking began come from GitHub's star-history endpoint; after that, from daily
  snapshots.
- A repository that disappears from your account is hidden, not deleted. Its history comes back if
  the repository does.
- If GitHub access is revoked, private repositories are hidden from that account until it signs in
  again. A followed repository that turns private is dropped from its followers.

## Known limits

- The overview adds up every daily snapshot of every repository on each load. That is instant for a
  few hundred repositories and a few years of history; very large organisations would want a
  pre-aggregated table.
- Accounts are synced one after another. One account with thousands of tracked repositories delays
  the others.
- The Dockerfile and the GitHub App sign-in path are written from the documentation and have not been
  run end to end yet; the OAuth App path and the single-user token path have.
