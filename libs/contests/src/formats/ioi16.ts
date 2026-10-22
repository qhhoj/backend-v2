import { POINTS_DECIMALS, pythonRound } from '@libs/judging';
import type { ContestFormat, ProblemCell, ScoringRow } from './format';
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

/** Legacy `get_best_subtask_point` for one submission: per batch the smallest case points. Each case outside batches (batch null or 0) is its own key (`case-<index>`), not pooled under one minimum as legacy did: `dataPoints` counts every plain case. */
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

/** Legacy `points_scaling_factor` divisor: plain cases outside batches and each batch start (`S`) add their points. */
export function dataPoints(
  cases: readonly { type: 'C' | 'S' | 'E'; points: number | null }[],
): number {
  let total = 0;
  let inBatch = false;
  for (const testCase of cases) {
    if (testCase.type === 'S') {
      inBatch = true;
      total += testCase.points ?? 0;
    } else if (testCase.type === 'E') inBatch = false;
    else if (!inBatch) total += testCase.points ?? 0;
  }
  return total;
}

/** A row's batch points count only once its run graded every case (D); an AB, IE or in-flight run may have stopped inside a batch. */
const gradedBatchPoints = (scored: ScoringRow): Record<string, number> =>
  scored.status === 'D' ? (scored.batchPoints ?? {}) : {};

/** Legacy `IOIContestFormat` (key `ioi16`): per batch the best across the participation's submissions, scaled by the contest points over the data's points; no times. A problem without data points scores 0 (legacy divided by zero). */
export const ioi16Format: ContestFormat<Ioi16Config> = {
  parseConfig: (raw) => parseKnownConfig<Ioi16Config>(raw, { cumtime: false }),
  score(rows, _config, context) {
    const problems = new Map(
      context.problems.map((problem) => [problem.problemId, problem]),
    );
    let score = 0;
    const formatData: Record<string, ProblemCell> = {};
    for (const [problemId, problemRows] of rowsByProblem(rows)) {
      const best: Record<string, number> = {};
      for (const scored of problemRows)
        for (const [batch, points] of Object.entries(gradedBatchPoints(scored)))
          best[batch] = Math.max(best[batch] ?? points, points);
      const problem = problems.get(problemId);
      const scale = problem?.dataPoints
        ? problem.points / problem.dataPoints
        : 0;
      // Rounded as a submission's points are, so a full cell is exactly the problem's points ("solved").
      const points = pythonRound(
        Object.values(best).reduce((sum, batch) => sum + batch * scale, 0),
        POINTS_DECIMALS,
      );
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
