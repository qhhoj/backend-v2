/** Wrong access codes per user (join and register); a right code gives the attempt back. */
export const ACCESS_CODE_USER_LIMIT = 10;
/** Wrong access codes per client address across users (`limiterAddress` of `request.ip`, which honours `TRUST_PROXY`: an IPv6 client counts per /64). */
export const ACCESS_CODE_IP_LIMIT = 30;
export const ACCESS_CODE_WINDOW_SECONDS = 10 * 60;
/** Legacy retried a virtual join until it won the numbering race; bounded here. */
export const VIRTUAL_JOIN_ATTEMPTS = 10;
/** Unknown, private, expired or hidden public ranking tokens per client IP; a hit gives the miss back. */
export const RANKING_TOKEN_MISS_LIMIT = 30;
export const RANKING_TOKEN_WINDOW_SECONDS = 10 * 60;
/** Announcement pushes per contest (resends included): each reaches every open stream of the contest. */
export const ANNOUNCEMENT_PUSH_LIMIT = 20;
export const ANNOUNCEMENT_PUSH_WINDOW_SECONDS = 60 * 60;
/** Export or data builds per contest per day, failed ones included (new; legacy had only "once a day while a zip is ready"): a failed build leaves no zip, so the zip rule alone let editors rerun 512 MiB builds back to back. Never given back. */
export const CONTEST_ZIP_BUILD_LIMIT = 3;
export const CONTEST_ZIP_BUILD_WINDOW_SECONDS = 86_400;
