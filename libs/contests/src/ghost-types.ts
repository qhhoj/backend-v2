import { uuidStr } from '@libs/database';
import type { ContestGhost } from '@libs/database';

export const GHOST_LIMIT = 2000;
export const GHOST_LABEL_MAX = 64;
export const GHOST_CAPTION_MAX = 64;
export const GHOST_CSV_MAX_BYTES = 1_048_576;

/** One solved problem of a ghost; null: the source lacks that datum. */
export interface GhostCell {
  problemId: string;
  /** Whole minutes from the contest start. */
  minute: number;
  rejectedBefore: number | null;
  points: number | null;
}

export interface GhostInput {
  label: string;
  caption: string;
  cells: GhostCell[];
}

/** A stored ghost as plain data (BSON UUIDs to strings); the api and the worker read ghosts through it. */
export const ghostInputOf = (row: ContestGhost): GhostInput => ({
  label: row.label,
  caption: row.caption,
  cells: row.cells.map((cell) => ({
    problemId: uuidStr(cell.problemId),
    minute: cell.minute,
    rejectedBefore: cell.rejectedBefore,
    points: cell.points,
  })),
});
