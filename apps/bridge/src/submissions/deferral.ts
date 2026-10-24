import type { DeferralReason, JudgeDeferral } from '@libs/database';
import { RetryReason } from '@libs/judge-proto';
import type { BridgeTimings } from '../bridge-timings';

/** A runaway judge answering at once cannot loop a row for the whole window: past this many deferrals it is IE too. */
export const MAX_DEFERRALS = 100;

/** `Final{RETRY}` reasons that are a transient judge problem, not a failure of the Submission. */
const DEFERRAL_OF: ReadonlyMap<RetryReason, DeferralReason> = new Map([
  [RetryReason.RETRY_REASON_DATA_UNAVAILABLE, 'data'],
  [RetryReason.RETRY_REASON_RUNTIME_MISSING, 'runtime'],
  [RetryReason.RETRY_REASON_SANDBOX_FAILURE, 'sandbox'],
]);

/** The transient reason a RETRY carries; null for the rest (UNSPECIFIED, unknown), which count toward the RETRY cap. */
export const deferralReasonOf = (reason: RetryReason): DeferralReason | null =>
  DEFERRAL_OF.get(reason) ?? null;

/** How far a backoff may stray either way: a data save during a contest defers every queued row of the problem at once, and they must not all come due together. */
const BACKOFF_JITTER = 0.2;

const jittered = (ms: number): number =>
  Math.round(ms * (1 - BACKOFF_JITTER + 2 * BACKOFF_JITTER * Math.random()));

/** The IE message once a row waited the whole window. */
export const DEFERRAL_LIMIT_MESSAGE: Record<DeferralReason, string> = {
  data: "The judge could not read this problem's test data for too long",
  runtime:
    "The judge was missing this submission's language runtime for too long",
  sandbox: "The judge's sandbox kept failing on this submission",
};

export type DeferralTimings = Pick<
  BridgeTimings,
  'deferralBackoffMs' | 'deferralMaxBackoffMs' | 'deferralWindowMs'
>;

/** The row's wait after one more transient RETRY at `now`: counted from the first one, backed off ×2 each time up to the cap (±20%); null once the window or `MAX_DEFERRALS` is reached (the row ends IE). */
export function nextDeferral(
  previous: JudgeDeferral | null,
  reason: DeferralReason,
  now: Date,
  timings: DeferralTimings,
): JudgeDeferral | null {
  const since = previous?.since ?? now;
  const count = (previous?.count ?? 0) + 1;
  const waited = now.getTime() - since.getTime();
  if (waited >= timings.deferralWindowMs || count > MAX_DEFERRALS) return null;
  const backoffMs = Math.min(
    timings.deferralMaxBackoffMs,
    timings.deferralBackoffMs * 2 ** (count - 1),
  );
  return {
    reason,
    since,
    count,
    retryAfter: new Date(now.getTime() + jittered(backoffMs)),
  };
}
