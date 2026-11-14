import { limiterAddress } from '@libs/common';

/** New shares per user (both kinds together): a burst budget and a daily one; a refused or failed create gives its hits back. */
export const CREATE_BURST_LIMIT = 5;
export const CREATE_BURST_WINDOW_SECONDS = 60;
export const CREATE_DAILY_LIMIT = 30;
export const CREATE_DAILY_WINDOW_SECONDS = 24 * 60 * 60;
/** Shares a user may have that have not expired. */
export const ACTIVE_SHARE_LIMIT = 200;
/** Public reads (page, raw, download) per visitor address or signed-in user, as short-link visits. */
export const READ_LIMIT = 120;
export const READ_WINDOW_SECONDS = 60;
/** Reports per user, as comment reports. */
export const REPORT_LIMIT = 10;
export const REPORT_WINDOW_SECONDS = 60 * 60;
/** A generated code that collides is redrawn this many times in all. */
export const MAX_CODE_ATTEMPTS = 5;

export const readKey = (viewer: { userId: string } | null, ip: string) =>
  viewer
    ? `share-read:user:${viewer.userId}`
    : `share-read:ip:${limiterAddress(ip)}`;
