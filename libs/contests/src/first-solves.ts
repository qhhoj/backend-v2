import { LIVE } from './contest-time';
import type { ProblemCell } from './formats/format';
import { FORMATS } from './formats/registry';
import type { FormatSetting } from './formats/registry';

export interface ProblemSummary {
  /** The participation credited with the first solve; null when none or the format shows no times. */
  firstSolve: string | null;
  acceptedCount: number;
}

export interface SolveRow {
  participationId: string;
  virtual: number;
  cells: Record<string, ProblemCell>;
}

/** The one definition of "solved": a cell worth the problem's full points (the ranking's `acceptedCount` rule); nothing solves a 0-point problem. */
export const isSolvedCell = (
  cell: ProblemCell | null | undefined,
  points: number,
): boolean => points > 0 && cell?.points === points;

/** Legacy `get_first_solves_and_total_ac`, one helper for every format: a cell worth the problem's full points is accepted; the first solve is the live row with the strictly smallest solve time, so a tie goes to the row ranked first. */
export function problemSummaries(
  format: FormatSetting,
  problems: readonly { problemId: string; points: number }[],
  rows: readonly SolveRow[],
): Map<string, ProblemSummary> {
  const definition = FORMATS[format.name];
  const config = definition.parseConfig(format.config);
  return new Map(
    problems.map(({ problemId, points }) => {
      let firstSolve: string | null = null;
      let earliest: number | null = null;
      let acceptedCount = 0;
      for (const standing of rows) {
        const cell = standing.cells[problemId];
        if (!isSolvedCell(cell, points)) continue;
        acceptedCount += 1;
        const time = definition.firstSolveTime(cell, config);
        if (
          standing.virtual === LIVE &&
          time !== null &&
          (earliest === null || time < earliest)
        ) {
          earliest = time;
          firstSolve = standing.participationId;
        }
      }
      return [problemId, { firstSolve, acceptedCount }];
    }),
  );
}
