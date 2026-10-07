import type {
  ContestFormat,
  ProblemCell,
  ScoringContext,
  ScoringRow,
} from './format';
import {
  bestOf,
  isTry,
  parseKnownConfig,
  roundScore,
  rowsByProblem,
  secondsSince,
  unfrozen,
} from './shared';

export interface VnojConfig {
  [key: string]: number | boolean;
  /** Minutes per try before the first best submission. */
  penalty: number;
  /** Last submission only: cumtime is the last solve time (plus penalty), not the sum. */
  lso: boolean;
}

const isPenalty = (value: number | boolean) =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

interface Totals {
  score: number;
  cumtime: number;
  tiebreaker: number;
  cells: Record<string, ProblemCell>;
}

/** Legacy `calculate_participation_info`: with `frozenAt`, only rows before it count (legacy `FROZEN_RANKING_SQL`). */
function vnojTotals(
  rows: readonly ScoringRow[],
  config: VnojConfig,
  context: ScoringContext,
  frozenAt: Date | null,
): Totals {
  const allRows = rowsByProblem(rows);
  const counted = (scored: ScoringRow) =>
    frozenAt === null || scored.date < frozenAt;
  let cumtime = 0;
  let last = 0;
  let penalty = 0;
  let score = 0;
  const cells: Record<string, ProblemCell> = {};
  for (const [problemId, problemRows] of rowsByProblem(rows.filter(counted))) {
    const best = bestOf(problemRows);
    const time = secondsSince(context.start, best.date);
    const tried = allRows.get(problemId)!.filter(isTry);
    let previous = 0;
    if (config.penalty) {
      const tries = tried.filter(counted);
      if (best.points) {
        previous =
          tries.filter((scored) => scored.date <= best.date).length - 1;
        penalty += previous * config.penalty * 60;
      } else previous = tries.length;
    }
    if (best.points) {
      cumtime += time;
      last = Math.max(last, time);
    }
    const cell: ProblemCell = { time, points: best.points, penalty: previous };
    const freezeFrom = context.frozenTime;
    if (frozenAt === null && freezeFrom !== null)
      cell.pending = tried.filter((scored) => scored.date >= freezeFrom).length;
    cells[problemId] = cell;
    score += best.points;
  }
  return {
    score: roundScore(score, context.pointsPrecision),
    cumtime: Math.max((config.lso ? last : cumtime) + penalty, 0),
    tiebreaker: last,
    cells,
  };
}

/** Legacy `VNOJContestFormat`: seconds to each problem's first best submission, `penalty` minutes per earlier try, `pending` tries after the freeze; the frozen board is recomputed from the rows before the freeze. */
export const vnojFormat: ContestFormat<VnojConfig> = {
  parseConfig: (raw) =>
    parseKnownConfig<VnojConfig>(
      raw,
      { penalty: 5, lso: false },
      { penalty: isPenalty },
    ),
  score(rows, config, context) {
    const live = vnojTotals(rows, config, context, null);
    const liveScore = {
      score: live.score,
      cumtime: live.cumtime,
      tiebreaker: live.tiebreaker,
      formatData: live.cells,
    };
    if (context.frozenTime === null) return unfrozen(liveScore);
    const frozen = vnojTotals(rows, config, context, context.frozenTime);
    // Legacy merge: every live problem gets frozen values, 0 when nothing came before the freeze.
    const frozenFormatData = Object.fromEntries(
      Object.entries(live.cells).map(([problemId, cell]) => {
        const before = frozen.cells[problemId];
        return [
          problemId,
          {
            time: before?.time ?? 0,
            points: before?.points ?? 0,
            penalty: before?.penalty ?? 0,
            pending: cell.pending,
          },
        ];
      }),
    );
    return {
      ...liveScore,
      frozenScore: frozen.score,
      frozenCumtime: frozen.cumtime,
      frozenTiebreaker: frozen.tiebreaker,
      frozenFormatData,
    };
  },
  firstSolveTime: (cell) => cell.time as number,
};
