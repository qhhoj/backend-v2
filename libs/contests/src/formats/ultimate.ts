import type { ContestFormat, ProblemCell } from './format';
import {
  rejectConfig,
  roundScore,
  rowsByProblem,
  secondsSince,
  unfrozen,
} from './shared';

/** Legacy `UltimateContestFormat`: each problem's last submission counts, timed from the contest start (legacy, also for virtual rows). Fixed: the tiebreaker is written (legacy wrote `tiebreak`) and the score is rounded. */
export const ultimateFormat: ContestFormat<Record<string, never>> = {
  parseConfig: rejectConfig,
  score(rows, _config, context) {
    let cumtime = 0;
    let last = 0;
    let score = 0;
    const formatData: Record<string, ProblemCell> = {};
    for (const [problemId, problemRows] of rowsByProblem(rows)) {
      const latest = problemRows.at(-1)!;
      let time = 0;
      if (latest.points) {
        time = secondsSince(context.contestStart, latest.date);
        cumtime += time;
        last = Math.max(last, time);
      }
      formatData[problemId] = { points: latest.points, time };
      score += latest.points;
    }
    return unfrozen({
      score: roundScore(score, context.pointsPrecision),
      cumtime: Math.max(cumtime, 0),
      tiebreaker: last,
      formatData,
    });
  },
  firstSolveTime: (cell) => cell.time as number,
};
