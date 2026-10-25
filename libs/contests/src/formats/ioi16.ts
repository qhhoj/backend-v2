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

/** Legacy `get_best_subtask_point` for one submission: per batch the smallest case points. Each case outside batches (batch null or 0) is its own key (`case-<index>`), not pooled under one minimum as legacy did: `dataPoints` counts every plain case a full run awards. */
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

/** Legacy `points_scaling_factor` divisor, counted as the judge's full run awards points: each batch start (`S`, pretest batches included) and each plain case outside batches add their points, except a plain pretest case, which a full run grades at 0 (judge-v2 `Pass::FullRunPretest`, decision 185). */
export function dataPoints(
  cases: readonly {
    type: 'C' | 'S' | 'E';
    points: number | null;
    isPretest?: boolean;
  }[],
): number {
  let total = 0;
  let inBatch = false;
  for (const testCase of cases) {
    if (testCase.type === 'S') {
      inBatch = true;
      total += testCase.points ?? 0;
    } else if (testCase.type === 'E') inBatch = false;
    else if (!inBatch && !testCase.isPretest) total += testCase.points ?? 0;
  }
  return total;
}

/** A row's batch points count only once its run graded every case (D); an AB, IE or in-flight run may have stopped inside a batch. */
const gradedBatchPoints = (scored: ScoringRow): Record<string, number> =>
  scored.status === 'D' ? (scored.batchPoints ?? {}) : {};

/** The best batches scaled to the contest points and rounded as a submission's points are: only every data point earned gives exactly the contest points ("solved"); short of them the cell stays below (`partialPoints`). A problem without data points (externally judged) takes its best submission's points, as the other formats do. */
function cellPoints(
  best: Record<string, number>,
  bestSubmission: number,
  problem: ScoringProblem | undefined,
): number {
  if (!problem) return 0;
  if (!problem.dataPoints) return bestSubmission;
  const scale = problem.points / problem.dataPoints;
  const batches = Object.values(best);
  const points = pythonRound(
    batches.reduce((sum, batch) => sum + batch * scale, 0),
    POINTS_DECIMALS,
  );
  const earned = batches.reduce((sum, batch) => sum + batch, 0);
  return earnedAll(earned, problem.dataPoints)
    ? points
    : partialPoints(points, problem.points);
}

/** One problem's cell: per batch the best across the problem's submissions. */
function problemPoints(
  problemRows: readonly ScoringRow[],
  problem: ScoringProblem | undefined,
): number {
  const best: Record<string, number> = {};
  for (const scored of problemRows)
    for (const [batch, points] of Object.entries(gradedBatchPoints(scored)))
      best[batch] = Math.max(best[batch] ?? points, points);
  const bestSubmission = Math.max(
    ...problemRows.map((scored) => scored.points),
  );
  return cellPoints(best, bestSubmission, problem);
}

/** Legacy `IOIContestFormat` (key `ioi16`): per batch the best across the participation's submissions, scaled by the contest points over the data's points; no times. A problem without data points scores its best submission (legacy divided by zero). */
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
