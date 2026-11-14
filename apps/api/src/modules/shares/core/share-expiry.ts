/** How long a new or edited share lives, counted from the request. */
export const SHARE_EXPIRIES = ['never', '1d', '7d', '30d'] as const;
export type ShareExpiry = (typeof SHARE_EXPIRIES)[number];

const DAY_MS = 24 * 60 * 60 * 1000;
const LIFETIME_DAYS: Record<Exclude<ShareExpiry, 'never'>, number> = {
  '1d': 1,
  '7d': 7,
  '30d': 30,
};

/** Null for `never`, which the TTL index leaves alone. */
export const expiresAtOf = (expiry: ShareExpiry, now: Date): Date | null =>
  expiry === 'never'
    ? null
    : new Date(now.getTime() + LIFETIME_DAYS[expiry] * DAY_MS);

/** The TTL monitor runs about once a minute, so reads check the time themselves. */
export const isExpired = (
  share: { expiresAt: Date | null },
  now: Date,
): boolean => share.expiresAt !== null && share.expiresAt <= now;
