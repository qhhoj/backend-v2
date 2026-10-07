/** Wrong access codes per user (join and register); a right code gives the attempt back. */
export const ACCESS_CODE_USER_LIMIT = 10;
/** Wrong access codes per client IP across users (`request.ip`, honouring `TRUST_PROXY`). */
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
