import type { BadgeMetric } from '../shared/api.ts';
import type { DB } from './db.ts';
import { sharedRepo } from './queries.ts';

export const BADGE_METRICS: BadgeMetric[] = ['views', 'visitors', 'clones', 'stars', 'downloads'];

const LABELS: Record<BadgeMetric, string> = {
  views: 'lifetime views',
  visitors: 'lifetime visitors',
  clones: 'lifetime clones',
  stars: 'stars',
  downloads: 'downloads',
};

export function compact(n: number): string {
  if (n < 1000) return String(n);
  const units: Array<[number, string]> = [[1e9, 'B'], [1e6, 'M'], [1e3, 'k']];
  for (const [size, suffix] of units) {
    if (n >= size) {
      const value = n / size;
      return `${value >= 100 ? Math.round(value) : value.toFixed(1).replace(/\.0$/, '')}${suffix}`;
    }
  }
  return String(n);
}

const escapeXml = (s: string) => s.replace(/[<>&"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

// Verdana 11px averages about 6.4px per character; close enough for a badge.
const textWidth = (s: string) => Math.round(s.length * 6.4) + 10;

/** A flat shields-style badge. */
export function badgeSvg(label: string, value: string, color = '#2f6feb'): string {
  const lw = textWidth(label);
  const vw = textWidth(value);
  const width = lw + vw;
  const l = escapeXml(label);
  const v = escapeXml(value);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${l}: ${v}">
<title>${l}: ${v}</title>
<clipPath id="r"><rect width="${width}" height="20" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#r)">
<rect width="${lw}" height="20" fill="#3d444d"/>
<rect x="${lw}" width="${vw}" height="20" fill="${color}"/>
</g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
<text x="${lw / 2}" y="14">${l}</text>
<text x="${lw + vw / 2}" y="14">${v}</text>
</g>
</svg>`;
}

/** Badge for a shared repo, or null when the repo is unknown or sharing is off. */
export function repoBadge(db: DB, owner: string, name: string, metric: BadgeMetric): string | null {
  const repo = sharedRepo(db, owner, name);
  if (!repo) return null;
  let value: number;
  if (metric === 'stars') value = repo.stars;
  else if (metric === 'downloads') value = repo.release_downloads;
  else {
    const column = { views: 'views', visitors: 'uniques', clones: 'clones' }[metric];
    value = (db.prepare(`SELECT COALESCE(SUM(${column}), 0) n FROM traffic_daily WHERE repo_id = ?`).get(repo.id) as { n: number }).n;
  }
  return badgeSvg(LABELS[metric], compact(value));
}
