import type { ReactNode } from 'react';
import { Link, Navigate } from 'react-router-dom';
import type { Operator } from '../../shared/api.ts';
import { useApp } from '../context.tsx';
import { useTitle } from '../lib/hooks.ts';
import { Logo } from '../components/Icon.tsx';
import { SiteLinks } from '../components/SiteLinks.tsx';
import { ThemeToggle } from '../components/ui.tsx';

// The imprint, privacy and terms pages of a hosted instance. They describe what RepoEasy itself
// stores and does; who runs the instance comes from the OPERATOR_* settings.

const UPDATED = '4 October 2026';

function Address({ op }: { op: Operator }) {
  return (
    <address>
      {op.name}
      {op.address.map((line) => (
        <span key={line}>
          <br />
          {line}
        </span>
      ))}
    </address>
  );
}

function Contact({ op }: { op: Operator }) {
  return op.email ? <a href={`mailto:${op.email}`}>{op.email}</a> : <>the postal address above</>;
}

function LegalPage({ title, children }: { title: string; children: (op: Operator) => ReactNode }) {
  useTitle(title);
  const { info, me } = useApp();
  if (!info.operator) return <Navigate to="/" replace />;
  return (
    <div className="public">
      <header className="public-top">
        <Link to="/" className="brand" aria-label="RepoEasy home">
          <Logo />
          <span>RepoEasy</span>
        </Link>
        <div className="public-top-right">
          <Link className="btn btn-sm" to="/">
            {me ? 'Back to my dashboard' : 'Back to the start page'}
          </Link>
          <ThemeToggle />
        </div>
      </header>
      <main className="public-main legal" id="main">
        <h1>{title}</h1>
        {children(info.operator)}
      </main>
      <footer className="public-foot">
        <span className="muted">Last updated {UPDATED}</span>
        <SiteLinks />
      </footer>
    </div>
  );
}

export function Imprint() {
  return (
    <LegalPage title="Imprint">
      {(op) => (
        <>
          <p className="muted">Impressum. Information according to § 5 DDG.</p>
          <Address op={op} />
          <h2>Contact</h2>
          <p>
            <Contact op={op} />
          </p>
          <h2>Responsible for the content</h2>
          <p>{op.name}, address as above (§ 18 (2) MStV).</p>
          <h2>Consumer dispute resolution</h2>
          <p>We are neither willing nor obliged to take part in dispute resolution proceedings before a consumer arbitration board.</p>
          <h2>GitHub</h2>
          <p>RepoEasy is an independent project. It is not affiliated with, endorsed by or sponsored by GitHub or Codeberg.</p>
        </>
      )}
    </LegalPage>
  );
}

export function Privacy() {
  const { info } = useApp();
  return (
    <LegalPage title="Privacy">
      {(op) => (
        <>
          <p>
            This page says what RepoEasy on {window.location.host} stores about you, why, and for how long. The short version: no advertising, no third-party analytics, no
            tracking cookies, and your data is deleted when you delete your account.
          </p>

          <h2>Who is responsible</h2>
          <Address op={op} />
          <p>
            Contact: <Contact op={op} />
          </p>

          <h2>When you only visit</h2>
          <ul>
            <li>
              Your browser sends its IP address with every request. The server uses it to answer the request and to limit abuse, and does not write it to an access log. If a
              request fails, the entry in the server's error log can contain the address; that log is overwritten continuously.
            </li>
            <li>
              The server keeps a counter per day of how often the start page was opened and from where: either the <code>?ref=</code> tag of the link you followed or the name
              of the site that linked here. The counter holds numbers only. It cannot be traced back to you.
            </li>
            <li>No cookie is set. If you switch between the light and dark theme, your browser remembers that choice in its local storage; it is never sent anywhere.</li>
            <li>The pages load no fonts, scripts or images from other companies.</li>
          </ul>
          <p>Legal basis: Art. 6 (1) (f) GDPR, our interest in running the site securely and knowing roughly how many people visit it.</p>

          <h2>When you sign in</h2>
          <p>Signing in runs through GitHub. From then on the server stores:</p>
          <ul>
            <li>your GitHub user id, login, display name, the address of your avatar and, if your GitHub profile shows one publicly, your email address;</li>
            <li>an access token GitHub issues for your account, encrypted (AES-256-GCM), used only to read the data described below and for edits you make yourself;</li>
            <li>when the account was created, when you last signed in, roughly when you were last active, and the source you came from when you signed up;</li>
            <li>your settings, the tags and notes you add to repositories, and API tokens you create (only as a hash).</li>
          </ul>
          <p>
            Two cookies are needed for this: <code>re_oauth_state</code>, which lives for ten minutes while you sign in, and <code>re_session</code>, which keeps you signed in
            for up to 60 days and is deleted when you sign out. Neither is used for anything else, which is why there is no cookie banner. Once you are signed in, avatar images
            are loaded from GitHub's servers.
          </p>

          <h2>Your repositories</h2>
          <p>For the repositories your GitHub account can access, and the public repositories on GitHub or Codeberg you choose to follow, the server stores:</p>
          <ul>
            <li>name, description, topics, language, license and similar details shown on GitHub or Codeberg;</li>
            <li>daily numbers: views, unique visitors, clones, referring sites, popular pages, stars, forks, open issues and pull requests, release downloads;</li>
            <li>releases, and recent commits on the default branch: the first line of the message, the date, and the author's name, login and avatar as GitHub or Codeberg shows them.</li>
          </ul>
          <p>
            No source code is read or stored. Private repositories stay private: only accounts that can access them on GitHub see them here. A public statistics page or badge
            exists only for a public repository whose administrator switched it on, and can be switched off again at any time.
          </p>
          <p>Legal basis for everything in this and the previous section: Art. 6 (1) (b) GDPR, providing the service you signed up for.</p>

          {info.billing.enabled && (
            <>
              <h2>Payment</h2>
              <p>
                The Pro plan is paid through Stripe. Card and billing details are entered on Stripe's pages and never reach this server. The server stores your Stripe customer
                and subscription id, your plan and the date it is paid until. Stripe's own privacy policy applies to the checkout.
              </p>
            </>
          )}

          <h2>Who receives data</h2>
          <ul>
            {op.hosting && <li>{op.hosting}, which runs the server on our behalf.</li>}
            <li>GitHub, which receives the requests made with your access token. The data comes from GitHub in the first place.</li>
            <li>
              Codeberg e.V., if you follow a repository hosted there: the server asks Codeberg for that repository's public numbers. Nothing about you is sent along, and
              avatars of commit authors are then loaded from Codeberg's servers.
            </li>
            {info.billing.enabled && (
              <li>Stripe, for payments. Stripe may process data in the United States under the EU-U.S. Data Privacy Framework and standard contractual clauses.</li>
            )}
            <li>The address you enter yourself, if you set up webhook alerts.</li>
          </ul>
          <p>Nobody else. Data is not sold and not used for advertising.</p>

          <h2>How long it is kept</h2>
          <p>
            Until you delete your account under Settings. That removes the account, its access token, sessions, settings and notes at once, together with the history of every
            repository no other account on this site is linked to.
            {op.backupDays > 0 && ` Database snapshots are overwritten in rotation, so deleted data is gone from them after at most ${op.backupDays} days.`} The visit counters
            contain no personal data and are kept.
          </p>

          <h2>Your rights</h2>
          <p>
            You can ask what is stored about you, have it corrected or deleted, have its processing restricted, receive it in a machine-readable form, and object to
            processing that rests on our legitimate interests. Most of this works without asking: Settings offers a complete export as JSON and deleting the account, and every repository page exports CSV files.
            For anything else write to <Contact op={op} />. You also have the right to complain to a data protection supervisory authority, for example the one where you live.
          </p>
        </>
      )}
    </LegalPage>
  );
}

export function Terms() {
  const { info } = useApp();
  const paid = info.billing.enabled;
  return (
    <LegalPage title="Terms of service">
      {(op) => (
        <>
          <p>
            These terms apply to RepoEasy as offered on {window.location.host} by {op.name} ("we"). The software itself is open source under the MIT license; if you run your
            own copy, these terms do not apply to it.
          </p>

          <h2>1. The service</h2>
          <p>
            RepoEasy reads statistics about your GitHub repositories every day and keeps them, so that history remains available after GitHub's own 14 days. What each plan
            includes is shown on the start page and under Settings.
          </p>

          <h2>2. Your account</h2>
          <p>
            You sign in with your GitHub account and need to be allowed to access the repositories you track. You are responsible for keeping that GitHub account secure. You
            can delete your RepoEasy account at any time under Settings; your data is removed as described on the privacy page.
          </p>

          <h2>3. Fair use</h2>
          <p>
            Do not try to break or overload the service, work around the limits of your plan, access other people's data, or use the service in a way that violates GitHub's
            terms. Accounts that do can be suspended.
          </p>

          {paid && (
            <>
              <h2>4. Pro plan and payment</h2>
              <p>
                The price is shown before you pay ({info.billing.proMonthly} per month or {info.billing.proYearly} per year at the time of writing). Payment is handled by
                Stripe and charged in advance for each month or year. The subscription renews automatically until you cancel it, which you can do at any time under Settings,
                "Manage subscription". Cancelling takes effect at the end of the period you have paid for. After that the account returns to the free plan: nothing is
                deleted, and traffic archiving continues for as many repositories as the free plan includes.
              </p>
              <h2>5. Right of withdrawal</h2>
              <p>
                If you are a consumer, you can withdraw from a subscription within 14 days of taking it out, without giving a reason. Tell us in a clear statement, for example
                by email to <Contact op={op} />, before the 14 days are over. We then refund every payment you made for that subscription within 14 days, using the payment
                method you paid with.
              </p>
            </>
          )}

          <h2>{paid ? 6 : 4}. Availability</h2>
          <p>
            We run the service with care but do not promise that it is available without interruption. It depends on GitHub's interfaces, which can change or fail. Days that
            GitHub no longer reports cannot be recovered afterwards. Backups are made, yet you should export data you cannot afford to lose; the export is free on every plan.
          </p>

          <h2>{paid ? 7 : 5}. Liability</h2>
          <p>
            We are liable without limit for intent and gross negligence, for injury to life, body or health, and where the law requires it. For slight negligence we are liable
            only if an obligation essential to the contract was breached, and then only for the damage that was foreseeable and typical for this kind of contract. For the free
            plan we are liable only for intent and gross negligence.
          </p>

          <h2>{paid ? 8 : 6}. Ending the contract</h2>
          <p>
            You can stop using the service and delete your account at any time. We can end the contract with 30 days' notice, or immediately if an account violates section 3.
            If we end a paid subscription without such a reason, you get back the part of the price that covers the unused time.
          </p>

          <h2>{paid ? 9 : 7}. Changes</h2>
          <p>
            If these terms or the plans change in a way that matters to you, the new version is published on this page at least 30 days before it applies. If you do not agree,
            you can cancel before then.
          </p>

          <h2>{paid ? 10 : 8}. Law</h2>
          <p>
            German law applies. If you are a consumer living in another country of the European Union, the mandatory consumer protection rules of that country continue to
            protect you.
          </p>
        </>
      )}
    </LegalPage>
  );
}
