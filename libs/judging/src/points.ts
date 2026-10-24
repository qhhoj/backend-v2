/** Legacy `DMOJ_PP_STEP`, `DMOJ_PP_ENTRIES` and `DMOJ_PP_BONUS_FUNCTION` (0.05 per solved problem). */
export const PP_STEP = 0.98514;
export const PP_ENTRIES = 300;
export const PP_BONUS_PER_SOLVED = 0.05;

/** A user's result on one public, non-organisation-private problem. */
export interface ProblemBest {
  /** Largest `points` over the user's submissions to it. */
  maxPoints: number;
  /** Some submission matched `IS_SOLVED`. */
  solved: boolean;
}

export interface UserPoints {
  points: number;
  performancePoints: number;
  problemCount: number;
}

/** Legacy `user_completed_ids`: an AC whose cases earned everything, as an aggregation expression over a submission. */
export const IS_SOLVED = {
  $and: [{ $eq: ['$result', 'AC'] }, { $gte: ['$casePoints', '$caseTotal'] }],
};

/** `IS_SOLVED` as a query filter: `result` stays a plain field so the indexes on it serve the match. */
export const SOLVED_FILTER = {
  result: 'AC',
  $expr: { $gte: ['$casePoints', '$caseTotal'] },
};

/** `$group` accumulator: 1 when some submission of the group is solved, else 0. */
export const ANY_SOLVED = { $max: { $cond: [IS_SOLVED, 1, 0] } };

/** Legacy `Profile.calculate_points`: positive bests sorted descending; `points` sums them all, performance points weigh the first 300 by 0.98514^rank and add 0.05 per solved problem. V8's `**` differs from CPython's `pow` by 1 ulp on some ranks (~1e-12, far below legacy's 1e-6 float_compare), so recomputed legacy values may churn at that level. */
export function userPoints(bests: readonly ProblemBest[]): UserPoints {
  const earned = bests
    .map((best) => best.maxPoints)
    .filter((points) => points > 0)
    .sort((left, right) => right - left);
  const problemCount = bests.filter((best) => best.solved).length;
  return {
    points: earned.reduce((sum, points) => sum + points, 0),
    performancePoints:
      earned
        .slice(0, PP_ENTRIES)
        .reduce((sum, points, rank) => sum + PP_STEP ** rank * points, 0) +
      PP_BONUS_PER_SOLVED * problemCount,
    problemCount,
  };
}

/** Legacy `Problem.update_stats`: the percentage of accepted submissions, 0 without any. */
export const acceptanceRate = (accepted: number, total: number): number =>
  total ? (100 * accepted) / total : 0;
