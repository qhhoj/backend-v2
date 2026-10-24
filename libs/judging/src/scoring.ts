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

/** Python 3 `round(value, digits)`: nearest decimal of the exact binary value; only exact ties (0.125, 2.5) go to the even neighbour, where `toFixed` rounds away from zero. Keeps rescored legacy points identical. */
export function pythonRound(value: number, digits: number): number {
  const rounded = Number(value.toFixed(digits));
  // Scaling by a power of two is exact: a tie is an odd number of half-units.
  const halves = value * 2 ** (digits + 1);
  if (!Number.isInteger(halves) || halves % 2 === 0) return rounded;
  // The tie's decimal expansion has digits + 1 decimals; dropping the trailing 5 rounds toward zero.
  const towardZero = value.toFixed(digits + 1).slice(0, -1);
  const lastDigit = towardZero.endsWith('.')
    ? towardZero.at(-2)
    : towardZero.at(-1);
  return Number(lastDigit) % 2 === 0 ? Number(towardZero) : rounded;
}

/** Within float noise of the total counts as every point earned. */
const FULL_EPSILON = 1e-9;

/** Every point of `total` earned, up to float noise. */
export const earnedAll = (points: number, total: number): boolean =>
  points >= total - FULL_EPSILON;

/** The largest value with `decimals` decimals strictly below `total`, and 0 at least. */
const stepBelow = (total: number, decimals: number): number =>
  Math.max(0, Math.round(total * 10 ** decimals) - 1) / 10 ** decimals;

/** Sums to one decimal like legacy, except that only every point earned reaches the total: a near miss (9.96 of 10) stays a tenth below it, and a full sum takes the rounded total exactly. */
function roundedSums(
  points: number,
  total: number,
): Pick<CaseTotals, 'casePoints' | 'caseTotal'> {
  const caseTotal = pythonRound(total, 1);
  if (earnedAll(points, total)) return { casePoints: caseTotal, caseTotal };
  return {
    casePoints: Math.min(pythonRound(points, 1), stepBelow(caseTotal, 1)),
    caseTotal,
  };
}

/** Legacy `on_grading_end`: time and memory are the largest over cases; plain cases add their points and totals; a batch adds its smallest points and its largest total; sums are rounded by `roundedSums`. */
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
    ...roundedSums(points, total),
  };
}

/** Decimals a submission's points (and an ioi16 cell) keep: legacy `round(…, 3)`. */
export const POINTS_DECIMALS = 3;

/** Points already rounded to `POINTS_DECIMALS` for a result short of full: at most 0.001 below `fullPoints`, so rounding alone never gives full marks. */
export const partialPoints = (points: number, fullPoints: number): number =>
  Math.min(points, stepBelow(fullPoints, POINTS_DECIMALS));

/** Legacy `round(casePoints / caseTotal × problem.points, 3)`, except that only cases earning their whole total (as `IS_SOLVED`) reach the problem's points: a near miss stays below them (`partialPoints`). A non-partial problem scores 0 for anything less. The problem-rescore job uses this too. */
export function submissionPoints(
  casePoints: number,
  caseTotal: number,
  problemPoints: number,
  isPartial: boolean,
): number {
  const points =
    caseTotal > 0
      ? pythonRound((casePoints / caseTotal) * problemPoints, POINTS_DECIMALS)
      : 0;
  if (casePoints >= caseTotal) return points;
  return isPartial ? partialPoints(points, problemPoints) : 0;
}
