import type { ContestFormat, ProblemCell } from './format';
import {
  parseKnownConfig,
  roundScore,
  rowsByProblem,
  unfrozen,
} from './shared';

export interface FinalSubmissionConfig {
  [key: string]: boolean;
  /** Judge the pending submissions when the contest ends; false: only on an editor's request. */
  autoJudge: boolean;
}

/** Legacy `FinalSubmissionContestFormat`: each problem's last judged (non-`PD`) submission counts; no times, no tiebreak. The score is rounded like every format (legacy summed raw floats). */
export const finalSubmissionFormat: ContestFormat<FinalSubmissionConfig> = {
  parseConfig: (raw) =>
    parseKnownConfig<FinalSubmissionConfig>(raw, { autoJudge: true }),
  score(rows, _config, context) {
    let score = 0;
    const formatData: Record<string, ProblemCell> = {};
    const judged = rows.filter((scored) => scored.status !== 'PD');
    for (const [problemId, problemRows] of rowsByProblem(judged)) {
      const latest = problemRows.at(-1)!;
      formatData[problemId] = { points: latest.points, time: 0 };
      score += latest.points;
    }
    return unfrozen({
      score: roundScore(score, context.pointsPrecision),
      cumtime: 0,
      tiebreaker: 0,
      formatData,
    });
  },
  firstSolveTime: () => null,
};
