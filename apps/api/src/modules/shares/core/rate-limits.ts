import { limiterAddress } from '@libs/common';

/** New shares per user (both kinds together): a burst budget and a daily one; a refused or failed create gives its hits back. */
export const CREATE_BURST_LIMIT = 5;
export const CREATE_BURST_WINDOW_SECONDS = 60;
export const CREATE_DAILY_LIMIT = 30;
export const CREATE_DAILY_WINDOW_SECONDS = 24 * 60 * 60;
/** Shares a user may have that have not expired. */
export const ACTIVE_SHARE_LIMIT = 200;
/** Public reads (page, raw, download) per address, and per user too when signed in, as short-link visits. */
export const READ_LIMIT = 120;
export const READ_WINDOW_SECONDS = 60;
/** Edits and deletes per user. */
export const MANAGE_LIMIT = 60;
export const MANAGE_WINDOW_SECONDS = 60;
/** The per-user create lock: held across the active count and the insert; a wait longer than this is a 409. */
export const CREATE_LOCK_SECONDS = 10;
export const CREATE_LOCK_WAIT_SECONDS = 3;
/** Reports per user, as comment reports. */
export const REPORT_LIMIT = 10;
export const REPORT_WINDOW_SECONDS = 60 * 60;
/** A generated code that collides is redrawn this many times in all. */
export const MAX_CODE_ATTEMPTS = 5;

/** Signed-in readers count against their address too, so one address cannot multiply its budget with accounts. */
export const readKeys = (viewer: { userId: string } | null, ip: string) => {
  const addressKey = `share-read:ip:${limiterAddress(ip)}`;
  return viewer
    ? [`share-read:user:${viewer.userId}`, addressKey]
    : [addressKey];
};

export const manageKey = (userId: string) => `share-manage:user:${userId}`;
