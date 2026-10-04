import type { RepoHost } from './api.ts';

/**
 * Accepts `owner/name`, a github.com or codeberg.org URL (with or without the scheme), or a clone URL.
 * A bare `owner/name` means GitHub. Used by the follow form in the browser and by the API, so both
 * accept the same input.
 */
export function parseRepoName(input: string): { host: RepoHost; owner: string; name: string } | null {
  const hosted = /^(?:(?:https?|ssh|git):\/\/)?(?:git@)?(?:www\.)?(github\.com|codeberg\.org)[/:](.*)$/i.exec(input.trim());
  const host: RepoHost = hosted?.[1]?.toLowerCase() === 'codeberg.org' ? 'codeberg' : 'github';
  // Codeberg also allows dots and underscores in user names
  const owner = host === 'github' ? '[A-Za-z0-9][A-Za-z0-9-]{0,38}' : '[A-Za-z0-9][A-Za-z0-9._-]{0,39}';
  const match = new RegExp(`^(${owner})/([A-Za-z0-9._-]{1,100}?)(?:\\.git)?(?:[/?#].*)?$`).exec(hosted ? hosted[2]! : input.trim());
  if (!match || /^\.+$/.test(match[2]!)) return null;
  return { host, owner: match[1]!, name: match[2]! };
}
