import {
  earnedAll,
  partialPoints,
  POINTS_DECIMALS,
  pythonRound,
} from '@libs/judging';
import type {
  ContestFormat,
  ProblemCell,
  ScoringProblem,
  ScoringRow,
} from './format';
import {
  bestOf,
  parseKnownConfig,
  roundScore,
  rowsByProblem,
  unfrozen,
} from './shared';

export interface Ioi16Config {
  [key: string]: boolean;
  /** Only shows solve times; scoring ignores it (legacy). */
  cumtime: boolean;
}

/** Legacy `get_best_subtask_point` for one submission: per batch the smallest case points. Each case outside batches (batch null or 0) is its own key (`case-<index>`), not pooled under one minimum as legacy did: the divisors count every plain case the run awards. */
export function batchMinima(
  cases: readonly { points: number; batch: number | null }[],
): Record<string, number> {
  const minima: Record<string, number> = {};
  for (const [index, testCase] of cases.entries()) {
    const batch = testCase.batch ?? 0;
    const key = batch > 0 ? String(batch) : `case-${index}`;
    minima[key] =
      key in minima ? Math.min(minima[key], testCase.points) : testCase.points;
  }
  return minima;
}

interface DataCase {
  type: 'C' | 'S' | 'E';
  points: number | null;
  isPretest?: boolean;
}

/** Legacy `points_scaling_factor` walk (`judge/models/contest.py`): every batch start (`S`) and every plain case outside batches adds its points; a full run's divisor leaves out the plain pretest cases. */
function batchAndPlainPoints(
  cases: readonly DataCase[],
  withPlainPretests: boolean,
): number {
  let total = 0;
  let inBatch = false;
  for (const testCase of cases) {
    if (testCase.type === 'E') inBatch = false;
    else if (testCase.type === 'S') {
      inBatch = true;
      total += testCase.points ?? 0;
    } else if (!inBatch && (withPlainPretests || !testCase.isPretest))
      total += testCase.points ?? 0;
  }
  return total;
}

/** The divisor of a full run: it grades the pretests first with a plain pretest case worth 0 (judge-v2 `Pass::FullRunPretest`, decision 185), so only batches and plain test cases count. */
export const dataPoints = (cases: readonly DataCase[]): number =>
  batchAndPlainPoints(cases, false);

/** Legacy `points_scaling_factor` divisor, plain pretests included: the divisor of a pretest-only run (`runPretestsOnly` and the problem's `isPretested`), as legacy ioi16 scaled every run. */
export const allDataPoints = (cases: readonly DataCase[]): number =>
  batchAndPlainPoints(cases, true);

/** A row's batch points count only once its run graded every case (D); an AB, IE or in-flight run may have stopped inside a batch. */
const gradedBatchPoints = (scored: ScoringRow): Record<string, number> =>
  scored.status === 'D' ? (scored.batchPoints ?? {}) : {};

/** Per batch the best across the rows of one kind of run (pretest-only or full): their batch keys overlap but their divisors differ. */
function bestBatches(
  problemRows: readonly ScoringRow[],
  isPretestRun: boolean,
): number[] {
  const best: Record<string, number> = {};
  for (const scored of problemRows)
    if (scored.isPretested === isPretestRun)
      for (const [batch, points] of Object.entries(gradedBatchPoints(scored)))
        best[batch] = Math.max(best[batch] ?? points, points);
  return Object.values(best);
}

/** Best batches scaled to the contest points and rounded as a submission's points are: only every point the run awards gives exactly the contest points ("solved"), never more; short of them the cell stays below (`partialPoints`). A run kind that awards nothing scores 0. */
function scaledPoints(
  batches: readonly number[],
  divisor: number,
  problemPoints: number,
): number {
  if (!divisor) return 0;
  const earned = batches.reduce((sum, batch) => sum + batch, 0);
  if (earnedAll(earned, divisor)) return problemPoints;
  const scale = problemPoints / divisor;
  const points = pythonRound(
    batches.reduce((sum, batch) => sum + batch * scale, 0),
    POINTS_DECIMALS,
  );
  return partialPoints(points, problemPoints);
}

/** One problem's cell: the better of its full runs (over `dataPoints`) and its pretest-only runs (over `allDataPoints`, so a pretest-only pass shows the pretests' share, as legacy), each the per-batch best. A problem with no case points at all (externally judged) takes its best submission's points, as the other formats do. */
function problemPoints(
  problemRows: readonly ScoringRow[],
  problem: ScoringProblem | undefined,
): number {
  if (!problem) return 0;
  const fullRun = problem.dataPoints ?? 0;
  const pretestRun = problem.allDataPoints ?? 0;
  if (!fullRun && !pretestRun) return bestOf(problemRows).points;
  return Math.max(
    scaledPoints(bestBatches(problemRows, false), fullRun, problem.points),
    scaledPoints(bestBatches(problemRows, true), pretestRun, problem.points),
  );
}

/** Legacy `IOIContestFormat` (key `ioi16`): per batch the best across the participation's submissions, scaled by the contest points over the run's divisor (full and pretest-only runs apart); no times. A problem without data points scores its best submission (legacy divided by zero). */
export const ioi16Format: ContestFormat<Ioi16Config> = {
  parseConfig: (raw) => parseKnownConfig<Ioi16Config>(raw, { cumtime: false }),
  score(rows, _config, context) {
    const problems = new Map(
      context.problems.map((problem) => [problem.problemId, problem]),
    );
    let score = 0;
    const formatData: Record<string, ProblemCell> = {};
    for (const [problemId, problemRows] of rowsByProblem(rows)) {
      const points = problemPoints(problemRows, problems.get(problemId));
      formatData[problemId] = { points, time: 0 };
      score += points;
    }
    return unfrozen({
      score: roundScore(score, context.pointsPrecision),
      cumtime: 0,
      tiebreaker: 0,
      formatData,
    });
  },
  firstSolveTime: (cell, config) =>
    config.cumtime ? (cell.time as number) : null,
};
