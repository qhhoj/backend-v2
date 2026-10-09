import { isSolvedCell, problemSummaries } from './first-solves';
import type { SolveRow } from './first-solves';
import type { FormatSetting } from './formats/registry';

export interface BalloonItem {
  participationId: string;
  problemId: string;
  /** Seconds from the team's start; null when the solved cell carries no time. */
  solvedAt: number | null;
  isFirst: boolean;
}

interface QueueEntry {
  item: BalloonItem;
  problemOrder: number;
}

const UNKNOWN_TIME = Number.MAX_SAFE_INTEGER;

const timeKey = (item: BalloonItem): number => item.solvedAt ?? UNKNOWN_TIME;

const inQueueOrder = (left: QueueEntry, right: QueueEntry): number =>
  timeKey(left.item) - timeKey(right.item) ||
  left.problemOrder - right.problemOrder ||
  left.item.participationId.localeCompare(right.item.participationId);

const entryOf = (
  row: SolveRow,
  problemId: string,
  problemOrder: number,
  firstSolveId: string | null,
): QueueEntry => {
  const cell = row.cells[problemId];
  const solvedAt = typeof cell.time === 'number' ? cell.time : null;
  return {
    item: {
      participationId: row.participationId,
      problemId,
      solvedAt,
      isFirst: firstSolveId === row.participationId,
    },
    problemOrder,
  };
};

/**
 * The balloon queue, derived from the live cells: one item per solved (full points) cell, in delivery order.
 * Nothing is stored, so a rescore that removes a solve removes its item and moves the first flag.
 */
export function balloonItems(
  format: FormatSetting,
  problems: ReadonlyArray<{ problemId: string; points: number }>,
  rows: readonly SolveRow[],
): BalloonItem[] {
  const summaries = problemSummaries(format, problems, rows);
  const entries = problems.flatMap(({ problemId, points }, problemOrder) => {
    const firstSolveId = summaries.get(problemId)?.firstSolve ?? null;
    return rows
      .filter((row) => isSolvedCell(row.cells[problemId], points))
      .map((row) => entryOf(row, problemId, problemOrder, firstSolveId));
  });
  return entries.sort(inQueueOrder).map(({ item }) => item);
}
