import { createHash } from 'node:crypto';

/** Rows kept in memory; the oldest are dropped past it (legacy `deque(maxlen=5000)`). */
export const ACTIVITY_BUFFER_MAX = 5000;
export const ACTIVITY_FLUSH_ROWS = 200;
export const ACTIVITY_FLUSH_MS = 2000;
/** `users.lastAccess` and the IP are written at most this often per user. */
export const ACCESS_WRITE_SECONDS = 300;
/** Legacy realtime window. */
export const ACTIVE_WINDOW_MS = 30 * 60_000;
export const ACTIVITY_TEXT_MAX = 500;
export const ACTIVITY_DAYS_MAX = 90;
export const ACTIVITY_DAYS_DEFAULT = 7;
export const ACTIVITY_PAGE_SIZE = 50;
export const ACTIVITY_EXPORT_MAX_ROWS = 100_000;

/** Paths and referers are stored without their query string (OAuth callbacks carry `code` and `state`). */
export const stripQuery = (url: string): string => {
  const queryStart = url.indexOf('?');
  return (queryStart < 0 ? url : url.slice(0, queryStart)).slice(
    0,
    ACTIVITY_TEXT_MAX,
  );
};

const UNTRACKED_PREFIXES = [
  '/healthz',
  '/media/',
  '/favicon.ico',
  '/robots.txt',
  '/api/internal/events/',
  '/api/internal/openapi',
  '/api/internal/admin/user-activity',
];
/** Exact paths: the SPA polls these on every page, so they would flood the log. */
const UNTRACKED_PATHS = ['/api/internal/auth/me', '/api/internal/site'];
export const isTrackedPath = (path: string): boolean =>
  !UNTRACKED_PATHS.includes(path) &&
  !UNTRACKED_PREFIXES.some((prefix) => path.startsWith(prefix));

/** A stable key per visitor that never contains the session id (a credential): cookie session, API token user, or the anonymous address-and-agent fingerprint. */
export function activitySessionKey({
  sessionId,
  userId,
  ip,
  userAgent,
}: {
  sessionId: string | null;
  userId: string | null;
  ip: string;
  userAgent: string;
}): string {
  const source = sessionId
    ? `session:${sessionId}`
    : userId
      ? `token:${userId}`
      : `anon:${ip}|${userAgent}`;
  return createHash('sha256').update(source).digest('hex');
}

export type DeviceType = 'desktop' | 'mobile' | 'tablet' | 'bot' | 'unknown';

const BOT =
  /bot|crawler|spider|crawling|slurp|bingpreview|facebookexternalhit|headless|curl\/|wget\/|python-requests|httpclient/i;
const TABLET = /ipad|tablet|android(?!.*mobile)/i;
const MOBILE = /mobi|iphone|android/i;
const BROWSERS: Array<[RegExp, string]> = [
  [/edg(e|a|ios)?\//i, 'Edge'],
  [/opr\/|opera/i, 'Opera'],
  [/firefox\/|fxios/i, 'Firefox'],
  [/chrome\/|crios/i, 'Chrome'],
  [/safari\//i, 'Safari'],
];
const SYSTEMS: Array<[RegExp, string]> = [
  [/windows/i, 'Windows'],
  [/android/i, 'Android'],
  [/iphone|ipad|ipod/i, 'iOS'],
  [/cros/i, 'ChromeOS'],
  [/mac os x|macintosh/i, 'macOS'],
  [/linux/i, 'Linux'],
];
const firstMatch = (table: Array<[RegExp, string]>, text: string): string =>
  table.find(([pattern]) => pattern.test(text))?.[1] ?? '';

export function classifyUserAgent(userAgent: string): {
  deviceType: DeviceType;
  browser: string;
  os: string;
} {
  if (!userAgent) return { deviceType: 'unknown', browser: '', os: '' };
  const deviceType: DeviceType = BOT.test(userAgent)
    ? 'bot'
    : TABLET.test(userAgent)
      ? 'tablet'
      : MOBILE.test(userAgent)
        ? 'mobile'
        : 'desktop';
  return {
    deviceType,
    browser: firstMatch(BROWSERS, userAgent),
    os: firstMatch(SYSTEMS, userAgent),
  };
}

const FORMULA_START = /^[=+\-@\t\r]/;
/** One CSV cell: a leading `= + - @` or control character gets a `'` (spreadsheets would run it as a formula), then RFC 4180 quoting. */
export const csvCell = (value: string | number | null): string => {
  const text = value === null ? '' : String(value);
  const safe = FORMULA_START.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
export const csvLine = (cells: Array<string | number | null>): string =>
  `${cells.map(csvCell).join(',')}\r\n`;
