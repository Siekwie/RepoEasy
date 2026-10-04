import { api } from './api.ts';

let pending: Promise<string> | null = null;

/**
 * Counts this page load as one landing-page view and resolves to where the visitor came from
 * (the `?ref=` tag of the link, or the site that linked here; '' when neither).
 * Sent once per page load. The answer is kept in memory only, nothing is stored in the browser.
 */
export function landingSource(): Promise<string> {
  if (!pending) {
    const params = new URLSearchParams(window.location.search);
    pending = api
      .hit(params.get('ref') ?? params.get('utm_source') ?? '', document.referrer)
      .then((r) => r.source)
      .catch(() => '');
  }
  return pending;
}
