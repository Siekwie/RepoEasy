import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ApiTokenCreated, UserSettings } from '../../shared/api.ts';
import { useApp, type ThemePref } from '../context.tsx';
import { EXPORT_JSON_PATH, api } from '../lib/api.ts';
import { fmtDateTime, fmtDay, relative } from '../lib/format.ts';
import { useFetch, useTitle } from '../lib/hooks.ts';
import { Icon } from '../components/Icon.tsx';
import { Avatar, Card, CopyButton, DownloadButton, ErrorBox, InstallRepos, PageHead, PlanBadge, Seg, Skeleton, Switch, UsageMeter } from '../components/ui.tsx';

export function Settings() {
  useTitle('Settings');
  const { me, info, startCheckout, fail, reloadMe, toast } = useApp();
  const [sp, setSp] = useSearchParams();
  const [portalBusy, setPortalBusy] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once, for the ?billing= flag Stripe returns with
  useEffect(() => {
    const b = sp.get('billing');
    if (!b) return;
    if (b === 'success') {
      toast('Thanks. Your plan will update in a moment.', 'success');
      void reloadMe();
    }
    setSp(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.delete('billing');
        return n;
      },
      { replace: true },
    );
  }, []);

  if (!me) return null;
  const billing = info.billing.enabled;

  async function portal() {
    setPortalBusy(true);
    try {
      const { url } = await api.portal();
      window.location.href = url;
    } catch (e) {
      fail(e);
      setPortalBusy(false);
    }
  }

  const planText =
    me.plan === 'selfhost'
      ? 'This is a self-hosted install. Everything is unlocked with no limits.'
      : me.plan === 'pro'
        ? 'You have Pro: unlimited tracked repositories, faster syncs, API tokens, webhooks and share pages.'
        : 'The Free plan keeps full lifetime history for a few repositories.';

  return (
    <>
      <PageHead title="Settings" />
      <div className="settings">
        <Card title="Account and plan" id="plan">
          <div className="account">
            <Avatar src={me.avatarUrl} name={me.login} size={48} />
            <div>
              <strong>{me.name || me.login}</strong>
              <div className="muted">@{me.login}</div>
            </div>
            <PlanBadge plan={me.plan} />
          </div>
          <p>{planText}</p>
          {info.auth.githubAppInstallUrl && (
            <p>
              <InstallRepos />
            </p>
          )}
          <dl className="facts">
            <div>
              <dt>Tracked repositories</dt>
              <dd>
                <UsageMeter kind="tracked" variant="fact" />
              </dd>
            </div>
            <div>
              <dt>Followed repositories</dt>
              <dd>
                <UsageMeter kind="followed" variant="fact" />
              </dd>
            </div>
            <div>
              <dt>Sync</dt>
              <dd>Every {me.limits.syncIntervalHours} hours{me.sync.lastSyncAt ? `, last ${relative(me.sync.lastSyncAt)}` : ''}</dd>
            </div>
            {me.billing.renewsAt && (
              <div>
                <dt>Renews</dt>
                <dd>{fmtDay(me.billing.renewsAt.slice(0, 10))}</dd>
              </div>
            )}
          </dl>
          {billing && me.plan === 'free' && (
            <div className="upgrade">
              <div>
                <strong>Upgrade to Pro</strong>
                <p className="muted">
                  Unlimited tracked repositories, {info.limits.pro.followedRepos ?? 'unlimited'} followed, sync every {info.limits.pro.syncIntervalHours} hours, API tokens, webhook
                  alerts and public share pages.
                </p>
              </div>
              <div className="btn-row">
                <button type="button" className="btn btn-primary" onClick={() => void startCheckout('month')}>
                  {info.billing.proMonthly}/month
                </button>
                <button type="button" className="btn" onClick={() => void startCheckout('year')}>
                  {info.billing.proYearly}/year
                </button>
              </div>
            </div>
          )}
          {billing && me.billing.hasSubscription && (
            <button type="button" className="btn" disabled={portalBusy} onClick={() => void portal()}>
              Manage subscription
            </button>
          )}
        </Card>

        <NotificationsCard />
        <TokensCard />

        <AppearanceCard />

        <Card title="Your data" sub="Everything RepoEasy has archived for you stays yours.">
          <div className="btn-row">
            <DownloadButton path={EXPORT_JSON_PATH} fallbackName="repoeasy-export.json" className="btn">
              <Icon name="download" size={14} /> Download full export (JSON)
            </DownloadButton>
          </div>
        </Card>

        <DeleteCard />
      </div>
    </>
  );
}

function NotificationsCard() {
  const { me, setMe, fail, toast, info } = useApp();
  const [draft, setDraft] = useState<UserSettings | null>(me?.settings ?? null);
  const [saving, setSaving] = useState(false);
  if (!me || !draft) return null;
  const canHook = me.limits.webhooks;
  const s = me.settings;
  const dirty =
    (draft.webhookUrl ?? '') !== (s.webhookUrl ?? '') ||
    draft.notifyMilestones !== s.notifyMilestones ||
    draft.notifySpikes !== s.notifySpikes ||
    draft.notifyReleases !== s.notifyReleases ||
    draft.autoTrackNew !== s.autoTrackNew;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setSaving(true);
    try {
      const url = (draft.webhookUrl ?? '').trim();
      const m = await api.patchSettings({ ...draft, webhookUrl: url || null });
      setMe(m);
      setDraft(m.settings);
      toast('Settings saved', 'success');
    } catch (err) {
      fail(err);
    } finally {
      setSaving(false);
    }
  }
  const set = <K extends keyof UserSettings>(k: K, v: UserSettings[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  return (
    <Card title="Notifications" sub="RepoEasy posts to a webhook when something notable happens. Discord, Slack and generic JSON endpoints work.">
      <form className="form" onSubmit={(e) => void save(e)}>
        {!canHook && (
          <p className="note">
            Webhook alerts are part of Pro.{' '}
            {info.billing.enabled && me.plan === 'free' ? (
              <a href="#plan">Upgrade above</a>
            ) : null}
          </p>
        )}
        <label className="field">
          <span className="field-label">Webhook URL</span>
          <input
            type="url"
            value={draft.webhookUrl ?? ''}
            disabled={!canHook}
            placeholder="https://discord.com/api/webhooks/…"
            onChange={(e) => set('webhookUrl', e.target.value)}
          />
        </label>
        <fieldset className="switches" disabled={!canHook}>
          <legend className="field-label">Send an alert for</legend>
          <Switch checked={draft.notifyMilestones} onChange={(v) => set('notifyMilestones', v)} label="Star and fork milestones" disabled={!canHook} />
          <Switch checked={draft.notifySpikes} onChange={(v) => set('notifySpikes', v)} label="Traffic spikes" disabled={!canHook} />
          <Switch checked={draft.notifyReleases} onChange={(v) => set('notifyReleases', v)} label="New releases" disabled={!canHook} />
        </fieldset>
        <div className="switches">
          <Switch checked={draft.autoTrackNew} onChange={(v) => set('autoTrackNew', v)} label="Automatically track new repositories I create" />
        </div>
        <div>
          <button className="btn btn-primary" type="submit" disabled={!dirty || saving}>
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </form>
    </Card>
  );
}

function TokensCard() {
  const { me, fail, toast, syncVersion } = useApp();
  const allowed = !!me?.limits.apiTokens;
  const tokens = useFetch(() => (allowed ? api.tokens() : Promise.resolve([])), [allowed], syncVersion);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<ApiTokenCreated | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    setCreating(true);
    try {
      const t = await api.createToken(n);
      setCreated(t);
      setName('');
      tokens.setData((prev) => [t, ...(prev ?? [])]);
    } catch (err) {
      fail(err);
    } finally {
      setCreating(false);
    }
  }

  async function remove(id: number, tokenName: string) {
    if (!window.confirm(`Delete the token "${tokenName}"? Anything using it will stop working.`)) return;
    try {
      await api.deleteToken(id);
      tokens.setData((prev) => prev?.filter((t) => t.id !== id) ?? prev);
      if (created?.id === id) setCreated(null);
      toast('Token deleted');
    } catch (err) {
      fail(err);
    }
  }

  const curl = created ? `curl -H "Authorization: Bearer ${created.token}" ${window.location.origin}/api/repos` : '';

  return (
    <Card title="API tokens" sub="Read your data from scripts and dashboards. Tokens act as you.">
      {!allowed && (
        <p className="note">
          API tokens are part of Pro. <a href="#plan">See plans</a>
        </p>
      )}
      <form className="inline-form" onSubmit={(e) => void create(e)}>
        <label className="field grow">
          <span className="field-label">Token name</span>
          <input type="text" value={name} maxLength={60} disabled={!allowed} placeholder="e.g. Grafana" onChange={(e) => setName(e.target.value)} />
        </label>
        <button className="btn btn-primary" type="submit" disabled={!allowed || creating || !name.trim()}>
          Create token
        </button>
      </form>
      {created && (
        <div className="callout" role="status">
          <strong>Copy your new token now. It won't be shown again.</strong>
          <div className="share-row">
            <code className="code-line">{created.token}</code>
            <CopyButton text={created.token} label="Copy token" />
          </div>
          <p className="muted">Try it:</p>
          <div className="share-row">
            <code className="code-line">{curl}</code>
            <CopyButton text={curl} label="Copy command" />
          </div>
          <button type="button" className="btn btn-sm btn-quiet" onClick={() => setCreated(null)}>
            I've saved it
          </button>
        </div>
      )}
      {allowed && tokens.error && <ErrorBox error={tokens.error} onRetry={tokens.reload} stale={!!tokens.data} />}
      {allowed && !tokens.data && !tokens.error && <Skeleton height={60} />}
      {allowed && tokens.data && tokens.data.length === 0 && <p className="muted pad">No tokens yet.</p>}
      {tokens.data && tokens.data.length > 0 && (
        <div className="table-wrap" tabIndex={0}>
          <table className="table table-compact">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Token</th>
                <th scope="col">Created</th>
                <th scope="col">Last used</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {tokens.data.map((t) => (
                <tr key={t.id}>
                  <th scope="row">{t.name}</th>
                  <td>
                    <code>{t.prefix}</code>
                  </td>
                  <td title={fmtDateTime(t.createdAt)}>{relative(t.createdAt)}</td>
                  <td title={t.lastUsedAt ? fmtDateTime(t.lastUsedAt) : undefined}>{t.lastUsedAt ? relative(t.lastUsedAt) : 'Never'}</td>
                  <td className="r">
                    <button type="button" className="btn btn-sm btn-icon" onClick={() => void remove(t.id, t.name)} aria-label={`Delete token ${t.name}`} title="Delete token">
                      <Icon name="trash" size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function AppearanceCard() {
  const { themePref, setThemePref } = useApp();
  return (
    <Card title="Appearance">
      <Seg<ThemePref>
        label="Theme"
        value={themePref}
        onChange={setThemePref}
        options={[
          { value: 'system', label: 'Match system' },
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ]}
      />
    </Card>
  );
}

function DeleteCard() {
  const { me, fail } = useApp();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  if (!me) return null;
  return (
    <Card title="Delete account" className="card-danger">
      <p>Permanently deletes your account and every archived number, tag and token. This can't be undone. Download an export first if you want a copy.</p>
      {!open ? (
        <button type="button" className="btn btn-danger" onClick={() => setOpen(true)}>
          Delete my account…
        </button>
      ) : (
        <form
          className="inline-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await api.deleteMe();
              window.location.assign('/');
            } catch (err) {
              fail(err);
              setBusy(false);
            }
          }}
        >
          <label className="field grow">
            <span className="field-label">
              Type <strong>{me.login}</strong> to confirm
            </span>
            <input type="text" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
          </label>
          <button className="btn btn-danger" type="submit" disabled={typed !== me.login || busy}>
            {busy ? 'Deleting…' : 'Delete everything'}
          </button>
          <button
            className="btn btn-quiet"
            type="button"
            onClick={() => {
              setOpen(false);
              setTyped('');
            }}
          >
            Cancel
          </button>
        </form>
      )}
    </Card>
  );
}
