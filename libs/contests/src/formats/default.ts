import type { ContestFormat, ProblemCell } from './format';
import {
  rejectConfig,
  roundScore,
  rowsByProblem,
  secondsSince,
  unfrozen,
} from './shared';

/** Legacy `DefaultContestFormat`: best points per problem; the time is the problem's latest submission (even a worse one); cumtime adds the times of scored problems. */
export const defaultFormat: ContestFormat<Record<string, never>> = {
  parseConfig: rejectConfig,
  score(rows, _config, context) {
    let cumtime = 0;
    let points = 0;
    const formatData: Record<string, ProblemCell> = {};
    for (const [problemId, problemRows] of rowsByProblem(rows)) {
      const best = Math.max(...problemRows.map((scored) => scored.points));
      const time = secondsSince(context.start, problemRows.at(-1)!.date);
      if (best) cumtime += time;
      formatData[problemId] = { time, points: best };
      points += best;
    }
    return unfrozen({
      score: roundScore(points, context.pointsPrecision),
      cumtime: Math.max(cumtime, 0),
      tiebreaker: 0,
      formatData,
    });
  },
  firstSolveTime: (cell) => cell.time as number,
};
