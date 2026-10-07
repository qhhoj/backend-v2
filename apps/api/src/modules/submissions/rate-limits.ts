/** Per user; every attempt counts (the budget is never released). */
export const SUBMIT_LIMIT = 20;
export const SUBMIT_WINDOW_SECONDS = 60;
/** Legacy `DMOJ_SUBMISSION_LIMIT`: unfinished (QU/P/G, not rejudged) submissions a user may have without `judge.spam_submission`. */
export const UNFINISHED_LIMIT = 2;
/** Per-user lock around the unfinished count and the insert; outlives one transaction. */
export const USER_LOCK_SECONDS = 10;

/** Legacy `DMOJ_SUBMISSIONS_REJUDGE_LIMIT`: a bulk rejudge above this needs `judge.rejudge_submission_lot`. */
export const BULK_REJUDGE_LIMIT = 10;

/** Live event streams (`submission-streams.service.ts`); counted per api process. */
export interface StreamLimits {
  /** Open submission streams per signed-in user. */
  perUser: number;
  /** Open streams (feed and submissions) per client IP (`request.ip`, which honours `TRUST_PROXY`). */
  perIp: number;
  /** Open streams per api process. */
  total: number;
  /** Open public-feed streams per api process (the feed needs no login, so it gets a tighter cap). */
  feedTotal: number;
  /** Open contest streams per api process (anonymous viewers of public contests included, so they get their own cap like the feed). */
  contestTotal: number;
  /** Hard bound on a client's backlog (`response.writableLength`: output queue plus socket write buffer; memory); a client that merely stops draining is dropped sooner, after `DRAIN_GRACE_MS`. The kernel's socket buffers hold more on top, per connection. */
  maxBufferedBytes: number;
  heartbeatMs: number;
  /** How often submission streams re-check the session and the detail rules (five lookups per stream per tick, one stream after another, so a tick can outlast this and the next is skipped: keep it at tens of seconds). */
  recheckMs: number;
}
export const STREAM_LIMITS = Symbol('STREAM_LIMITS');
export const DEFAULT_STREAM_LIMITS: StreamLimits = {
  perUser: 8,
  perIp: 16,
  total: 5000,
  feedTotal: 1000,
  contestTotal: 2000,
  maxBufferedBytes: 256 * 1024,
  heartbeatMs: 15_000,
  recheckMs: 60_000,
};
