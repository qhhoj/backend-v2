import type { CaseStatus, SubmissionCase } from '@libs/database';

/** Legacy `on_grading_end` `status_codes`: a submission's result is its worst case in this order. */
export const CASE_SEVERITY: readonly CaseStatus[] = [
  'SC',
  'AC',
  'WA',
  'MLE',
  'TLE',
  'IR',
  'RTE',
  'OLE',
];

export type GradableCase = Pick<
  SubmissionCase,
  'status' | 'time' | 'memory' | 'points' | 'total' | 'batch'
>;

export interface CaseTotals {
  time: number;
  memory: number;
  result: CaseStatus;
  casePoints: number;
  caseTotal: number;
}

/** Python 3 `round(value, digits)`: nearest decimal of the exact binary value; only exact ties (0.125, 2.5) go to the even neighbour, which `toFixed` would round up. Keeps rescored legacy points identical. */
export function pythonRound(value: number, digits: number): number {
  const exact = value.toFixed(100);
  const cut = exact.indexOf('.') + digits + 1;
  const isTie = exact[cut] === '5' && /^0*$/.test(exact.slice(cut + 1));
  if (!isTie) return Number(value.toFixed(digits));
  const scaled = value * 10 ** digits;
  return (
    (Math.floor(scaled) % 2 === 0 ? Math.floor(scaled) : Math.ceil(scaled)) /
    10 ** digits
  );
}

/** Legacy `on_grading_end`: time and memory are the largest over cases; plain cases add their points and totals; a batch adds its smallest points and its largest total; sums are rounded to one decimal. */
export function gradeCases(cases: readonly GradableCase[]): CaseTotals {
  let time = 0;
  let memory = 0;
  let severity = 0;
  let points = 0;
  let total = 0;
  const batches = new Map<number, { points: number; total: number }>();
  for (const testCase of cases) {
    time = Math.max(time, testCase.time);
    memory = Math.max(memory, testCase.memory);
    severity = Math.max(severity, CASE_SEVERITY.indexOf(testCase.status));
    if (testCase.batch === null) {
      points += testCase.points;
      total += testCase.total;
      continue;
    }
    const batch = batches.get(testCase.batch);
    batches.set(
      testCase.batch,
      batch
        ? {
            points: Math.min(batch.points, testCase.points),
            total: Math.max(batch.total, testCase.total),
          }
        : { points: testCase.points, total: testCase.total },
    );
  }
  for (const batch of batches.values()) {
    points += batch.points;
    total += batch.total;
  }
  return {
    time,
    memory,
    result: CASE_SEVERITY[severity],
    casePoints: pythonRound(points, 1),
    caseTotal: pythonRound(total, 1),
  };
}

/** Legacy: `round(casePoints / caseTotal × problem.points, 3)`, and 0 for a non-partial problem unless that is exactly full marks. 2b's rescore uses this too. */
export function submissionPoints(
  casePoints: number,
  caseTotal: number,
  problemPoints: number,
  partial: boolean,
): number {
  const points =
    caseTotal > 0
      ? pythonRound((casePoints / caseTotal) * problemPoints, 3)
      : 0;
  return partial || points === problemPoints ? points : 0;
}
