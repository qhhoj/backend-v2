/** Wrong access codes per user (join and register); a right code gives the attempt back. */
export const ACCESS_CODE_USER_LIMIT = 10;
/** Wrong access codes per client IP across users (`request.ip`, honouring `TRUST_PROXY`). */
export const ACCESS_CODE_IP_LIMIT = 30;
export const ACCESS_CODE_WINDOW_SECONDS = 10 * 60;
/** Legacy retried a virtual join until it won the numbering race; bounded here. */
export const VIRTUAL_JOIN_ATTEMPTS = 10;
