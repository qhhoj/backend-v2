import type { CaseStatus } from '@libs/database';
import type { ListCaseUnit } from './submission-access';

/** A list row carries at most this many case results; the rest are only counted. */
export const TEST_SUMMARY_CAP = 100;

/** The first cases of a submission as the list reads them: status and batch only. */
export interface CaseHead {
  status: CaseStatus;
  batch: number | null;
}

export interface TestSummary {
  unit: ListCaseUnit;
  statuses: CaseStatus[];
  batches: (number | null)[];
  more: number;
  total: number | null;
}

/** Per batch (in first-seen order) the first non-AC status, as the submission page's batch summary. */
function batchStatuses(head: readonly CaseHead[]): {
  statuses: CaseStatus[];
  batches: number[];
} {
  const statusOf = new Map<number, CaseStatus>();
  for (const { status, batch } of head) {
    if (batch === null) continue;
    const seen = statusOf.get(batch);
    if (seen === undefined || seen === 'AC') statusOf.set(batch, status);
  }
  return { statuses: [...statusOf.values()], batches: [...statusOf.keys()] };
}

/**
 * The row's strip: the first `TEST_SUMMARY_CAP` cases (or the batches they cover), how many judged cases lie past
 * them, and the problem's case count when every case is shown (so unjudged cases can be drawn as pending).
 */
export function testSummaryOf(
  unit: ListCaseUnit,
  head: readonly CaseHead[],
  judgedCount: number,
  problemCaseCount: number | null,
): TestSummary {
  const capped = head.slice(0, TEST_SUMMARY_CAP);
  const more = Math.max(0, judgedCount - capped.length);
  if (unit === 'batch')
    return { unit, ...batchStatuses(capped), more, total: null };
  return {
    unit,
    statuses: capped.map((testCase) => testCase.status),
    batches: capped.map((testCase) => testCase.batch),
    more,
    total: problemCaseCount,
  };
}
