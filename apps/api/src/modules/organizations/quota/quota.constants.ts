/** Set by the `problem-databytes` backfill; defined in `@libs/problems` so the worker shares it. */
export { QUOTA_BACKFILL_DONE_KEY } from '@libs/problems';
/** One data credit covers this many bytes (started). */
export const BYTES_PER_COST_UNIT = 10 * 1024 * 1024;
/** Usage at or above this share of a limit raises the near-limit flag. */
export const NEAR_LIMIT_PERCENT = 80;
