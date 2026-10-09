export const PROBLEM_DATABYTES_QUEUE = 'problem-databytes';
export const PROBLEM_DATABYTES_JOB = 'backfill';
/** A fixed id: BullMQ ignores an `add` while the job (kept after completion) still exists, so the backfill runs once per Redis, and again only after a flush, which is harmless (recompute-and-set). */
export const PROBLEM_DATABYTES_JOB_ID = 'problem-databytes-backfill-v1';
/** Redis key the `problem-databytes` backfill sets when it has recomputed every `dataBytes`; `quota.enforce = enforce` is honoured only while it exists, so a half-measured site never blocks anyone. */
export const QUOTA_BACKFILL_DONE_KEY = 'quota:databytes-backfilled';
