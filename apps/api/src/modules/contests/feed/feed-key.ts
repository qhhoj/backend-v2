import { randomBytes } from 'node:crypto';

export const FEED_USERNAME = 'feed';
export const FEED_KEY_PREFIX = 'qhf_';
export const DEFAULT_FEED_KEY_DAYS = 14;
export const MAX_FEED_KEY_DAYS = 30;
const DAY_MS = 86_400_000;

/** 192 random bits, url-safe: the Basic password a resolver tool is configured with. */
export const generateFeedKey = (): string =>
  `${FEED_KEY_PREFIX}${randomBytes(24).toString('base64url')}`;

export function parseBasicAuth(
  header: string | undefined,
): { username: string; password: string } | null {
  const match = /^basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(header ?? '');
  if (!match) return null;
  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  return colon < 0
    ? null
    : { username: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
}

export const isFeedKeyUsable = (
  key: { revokedAt: Date | null; expiresAt: Date },
  now: Date,
): boolean => key.revokedAt === null && key.expiresAt > now;

export const feedKeyExpiry = (now: Date, days = DEFAULT_FEED_KEY_DAYS): Date =>
  new Date(now.getTime() + days * DAY_MS);
