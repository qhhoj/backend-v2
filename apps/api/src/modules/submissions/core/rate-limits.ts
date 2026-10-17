/** Per user; every attempt counts (the budget is never released). */
export const SUBMIT_LIMIT = 20;
export const SUBMIT_WINDOW_SECONDS = 60;
/** Legacy `DMOJ_SUBMISSION_LIMIT`: unfinished (QU/P/G, not rejudged) submissions a user may have without `judge.spam_submission`. */
export const UNFINISHED_LIMIT = 2;
/** Per-user lock around the unfinished count and the insert; outlives one transaction. */
export const USER_LOCK_SECONDS = 10;

/** Legacy `DMOJ_SUBMISSIONS_REJUDGE_LIMIT`: a bulk rejudge above this needs `judge.rejudge_submission_lot`. */
export const BULK_REJUDGE_LIMIT = 10;

/** Per IP, visitors only: a result page can read up to 10000 case rows. Signed-in viewers are not limited. */
export const VISITOR_DETAIL_LIMIT = 300;
export const VISITOR_DETAIL_WINDOW_SECONDS = 60;
export const visitorDetailKey = (ip: string) => `submission-detail:ip:${ip}`;
