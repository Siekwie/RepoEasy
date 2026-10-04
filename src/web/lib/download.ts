/** File name from a `Content-Disposition` header (RFC 6266 `filename*` first, then `filename`). */
export function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);
  if (star) {
    try {
      return sanitize(decodeURIComponent(star[1]!.trim())) || fallback;
    } catch {
      /* malformed escape, fall through to the plain form */
    }
  }
  const plain = /filename\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]+))/.exec(header);
  const raw = plain ? (plain[1] !== undefined ? plain[1].replace(/\\(.)/g, '$1') : plain[2]!.trim()) : '';
  return sanitize(raw) || fallback;
}

/** Never let a header choose a path: keep only the last segment. */
function sanitize(name: string): string {
  return name.split(/[\\/]/).pop()!.trim();
}
