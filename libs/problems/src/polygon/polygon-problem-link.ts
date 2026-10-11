/** A Polygon problem page address: `https://polygon.codeforces.com/<token>/<owner>/<name>`. */
export interface PolygonProblemLink {
  /** The 7-character `p…` segment; Polygon's API never returns it, only a package's problem.xml records it. */
  token: string;
  owner: string;
  name: string;
}

export const POLYGON_LINK_MAX_LENGTH = 300;
const HOST = 'polygon.codeforces.com';
const TOKEN = /^p[0-9A-Za-z]{6}$/;
/** Codeforces handle charset. */
const OWNER = /^[A-Za-z0-9_.-]{1,24}$/;
/** Polygon short names: lowercase letters, digits and dashes. */
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * The parts of a problem page link, or null for anything else: https only, the exact host, no credentials or port,
 * exactly three path segments (one trailing slash allowed). A query or fragment (Polygon adds `?ccid=…`) is ignored.
 */
export function parsePolygonLink(text: string): PolygonProblemLink | null {
  const trimmed = text.trim();
  if (trimmed.length > POLYGON_LINK_MAX_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== HOST ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== ''
  )
    return null;
  const [token, owner, name, ...rest] = url.pathname
    .replace(/^\//, '')
    .replace(/\/$/, '')
    .split('/');
  if (rest.length > 0 || !TOKEN.test(token ?? '')) return null;
  if (!OWNER.test(owner ?? '') || !NAME.test(name ?? '')) return null;
  return { token, owner, name };
}
