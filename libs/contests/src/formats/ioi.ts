import type { ContestFormat, ProblemCell } from './format';
import {
  bestOf,
  parseKnownConfig,
  roundScore,
  rowsByProblem,
  secondsSince,
  unfrozen,
} from './shared';

export interface IoiConfig {
  [key: string]: boolean;
  cumtime: boolean;
  lastScoreAltering: boolean;
}

/** Legacy `LegacyIOIContestFormat` ("IOI (pre-2016)", key `ioi`): best points per problem timed at the first submission reaching them; without `cumtime`, cumtime is the last score-altering time. */
export const ioiFormat: ContestFormat<IoiConfig> = {
  parseConfig: (raw) =>
    parseKnownConfig<IoiConfig>(raw, {
      cumtime: false,
      lastScoreAltering: false,
    }),
  score(rows, config, context) {
    let cumtime = 0;
    let last = 0;
    let score = 0;
    const formatData: Record<string, ProblemCell> = {};
    for (const [problemId, problemRows] of rowsByProblem(rows)) {
      const best = bestOf(problemRows);
      let time = 0;
      if (best.points) {
        time = secondsSince(context.start, best.date);
        if (config.lastScoreAltering) last = Math.max(last, time);
        if (config.cumtime) cumtime += time;
      }
      formatData[problemId] = { points: best.points, time };
      score += best.points;
    }
    return unfrozen({
      score: roundScore(score, context.pointsPrecision),
      cumtime: config.cumtime ? Math.max(cumtime, 0) : last,
      tiebreaker: last,
      formatData,
    });
  },
  firstSolveTime: (cell, config) =>
    config.cumtime || config.lastScoreAltering ? (cell.time as number) : null,
};
