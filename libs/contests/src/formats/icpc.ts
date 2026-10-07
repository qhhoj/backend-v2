import type { ContestFormat, ProblemCell } from './format';
import {
  bestOf,
  isNonNegativeInteger,
  isTry,
  parseKnownConfig,
  roundScore,
  rowsByProblem,
  secondsSince,
} from './shared';

export interface IcpcConfig {
  [key: string]: number;
  /** Minutes per try before the first best submission. */
  penalty: number;
}

interface Totals {
  minutes: number;
  last: number;
  penalty: number;
  score: number;
}
const emptyTotals = (): Totals => ({
  minutes: 0,
  last: 0,
  penalty: 0,
  score: 0,
});

/** Legacy `ICPCContestFormat`: whole minutes from the start to each problem's first best submission, plus `penalty` minutes per earlier try (IE/CE/no result excluded); the tiebreaker is the last solve. Frozen totals leave out problems whose deciding submission came after the freeze. */
export const icpcFormat: ContestFormat<IcpcConfig> = {
  parseConfig: (raw) =>
    parseKnownConfig<IcpcConfig>(
      raw,
      { penalty: 20 },
      { penalty: isNonNegativeInteger },
    ),
  score(rows, config, context) {
    const frozenAt = context.frozenTime;
    const live = emptyTotals();
    const frozen = emptyTotals();
    const formatData: Record<string, ProblemCell> = {};
    const frozenFormatData: Record<string, ProblemCell> = {};
    for (const [problemId, problemRows] of rowsByProblem(rows)) {
      const best = bestOf(problemRows);
      const time = secondsSince(context.start, best.date);
      const minutes = Math.floor(time / 60);
      let pending = frozenAt !== null && best.date >= frozenAt;
      let tries = 0;
      let frozenTries = 0;
      if (config.penalty) {
        const tried = problemRows.filter(isTry);
        if (best.points) {
          tries = tried.filter((scored) => scored.date <= best.date).length;
          live.penalty += (tries - 1) * config.penalty;
          if (pending) frozenTries = tried.length;
          else {
            frozen.penalty += (tries - 1) * config.penalty;
            frozenTries = tries;
          }
        } else {
          tries = tried.length;
          frozenTries = tries;
          // Legacy: with no points the frozen state follows the last try.
          const latest = tried.at(-1)?.date ?? null;
          pending = frozenAt !== null && latest !== null && latest >= frozenAt;
        }
      }
      let frozenPoints = 0;
      if (best.points) {
        live.minutes += minutes;
        live.last = Math.max(live.last, minutes);
        live.score += best.points;
        if (!pending) {
          frozenPoints = best.points;
          frozen.minutes += minutes;
          frozen.last = Math.max(frozen.last, minutes);
          frozen.score += best.points;
        }
      }
      formatData[problemId] = { time, points: best.points, tries };
      frozenFormatData[problemId] = {
        time: frozenPoints ? time : null,
        points: frozenPoints,
        tries: frozenTries,
        pending,
      };
    }
    const precision = context.pointsPrecision;
    return {
      score: roundScore(live.score, precision),
      cumtime: Math.max(live.minutes + live.penalty, 0),
      tiebreaker: live.last,
      frozenScore: roundScore(frozen.score, precision),
      frozenCumtime: Math.max(frozen.minutes + frozen.penalty, 0),
      frozenTiebreaker: frozen.last,
      formatData,
      frozenFormatData,
    };
  },
  firstSolveTime: (cell) => cell.time as number | null,
};
