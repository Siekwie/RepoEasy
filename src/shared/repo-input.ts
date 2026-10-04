/**
 * Accepts `owner/name`, a github.com URL (with or without the scheme), or a clone URL.
 * Used by the follow form in the browser and by the API, so both accept the same input.
 */
export function parseRepoName(input: string): { owner: string; name: string } | null {
  const cleaned = input
    .trim()
    .replace(/^(?:(?:https?|ssh|git):\/\/)?(?:git@)?(?:www\.)?github\.com[/:]/i, '');
  const match = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?(?:[/?#].*)?$/.exec(cleaned);
  return match ? { owner: match[1]!, name: match[2]! } : null;
}
