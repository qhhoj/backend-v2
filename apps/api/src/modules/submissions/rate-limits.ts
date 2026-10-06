/** Per user; every attempt counts (the budget is never released). */
export const SUBMIT_LIMIT = 20;
export const SUBMIT_WINDOW_SECONDS = 60;
/** Legacy `DMOJ_SUBMISSION_LIMIT`: unfinished (QU/P/G, not rejudged) submissions a user may have without `judge.spam_submission`. */
export const UNFINISHED_LIMIT = 2;
/** Per-user lock around the unfinished count and the insert; outlives one transaction. */
export const USER_LOCK_SECONDS = 10;
