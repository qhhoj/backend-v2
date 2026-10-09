/** Redis key the `problem-databytes` backfill sets when it has recomputed every `dataBytes`; `enforce` is honoured only while it exists, so a half-measured site never blocks anyone. */
export const QUOTA_BACKFILL_DONE_KEY = 'quota:databytes-backfilled';
/** One data credit covers this many bytes (started). */
export const BYTES_PER_COST_UNIT = 10 * 1024 * 1024;
/** Usage at or above this share of a limit raises the near-limit flag. */
export const NEAR_LIMIT_PERCENT = 80;
