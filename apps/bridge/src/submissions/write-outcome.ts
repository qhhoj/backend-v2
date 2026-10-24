import { IN_FLIGHT_STATUSES } from '@libs/database';
import type { SubmissionStatus } from '@libs/database';
import type { AssignmentRef } from '@libs/judge-proto';
import { MAX_SUBMISSION_CASES } from '../link/link-limits';

/** One judge message's write: the run it belongs to, who sent it, and its seq. */
export interface RunKey {
  ref: AssignmentRef;
  judgeName: string;
  seq: number;
}

/**
 * What a judge-driven write did. `applied`: stored and `judgeSeq` advanced. `duplicate`: that seq is already stored (re-ack it).
 * `stale`: another judge or generation, or the run has ended (ignore it; the session aborts the run). `gap` (the seq skips one),
 * `full` (the case cap) and `order` (the next seq, but the message does not fit the run's status) are protocol errors.
 */
export type WriteOutcome =
  'applied' | 'duplicate' | 'stale' | 'gap' | 'full' | 'order';

/** The fields of a row that decide why a write missed; `cases` is counted, never loaded. */
export interface StoredRun {
  judgedOn: string | null;
  judgeGeneration: number;
  judgeSeq: number;
  status: SubmissionStatus;
  caseCount: number;
  /** RETRYs answered since the last rejudge (a missing field counts as 0). */
  retryCount: number;
  /** Judge builds that refused it as unsupported since the last rejudge (`refusedBy`, counted). */
  refusalCount: number;
}

export interface WriteExpectation {
  /** Statuses the write filtered on. */
  statuses: readonly SubmissionStatus[];
  /** Cases the write would append (CaseResults), else 0. */
  addsCases: number;
}

/** The row went back to QU on this run's own `Final{RETRY}` (a refusal included), which kept the run's generation and seq (`judgedOn` is cleared): a seq up to it is that Final or an earlier message, replayed. A rejudge resets `retryCount` and `refusedBy`, and every other requeue resets `judgeSeq`. */
const isRetriedRun = (key: RunKey, stored: StoredRun): boolean =>
  stored.judgedOn === null &&
  stored.status === 'QU' &&
  stored.retryCount + stored.refusalCount > 0 &&
  stored.judgeGeneration === key.ref.generation &&
  key.seq <= stored.judgeSeq;

/** Why a write filtered on `{judgedOn, judgeGeneration, judgeSeq: seq - 1, status}` matched nothing, from one read of the row (null: the row is gone). */
export function classifyMiss(
  key: RunKey,
  stored: StoredRun | null,
  expected: WriteExpectation,
): Exclude<WriteOutcome, 'applied'> {
  if (stored && isRetriedRun(key, stored)) return 'duplicate';
  if (
    !stored ||
    stored.judgedOn !== key.judgeName ||
    stored.judgeGeneration !== key.ref.generation
  )
    return 'stale';
  if (key.seq <= stored.judgeSeq) return 'duplicate';
  if (key.seq > stored.judgeSeq + 1) return 'gap';
  if (!expected.statuses.includes(stored.status))
    return IN_FLIGHT_STATUSES.includes(stored.status) ? 'order' : 'stale';
  if (stored.caseCount + expected.addsCases > MAX_SUBMISSION_CASES)
    return 'full';
  // the row changed between the write and this read: the next message decides
  return 'stale';
}
