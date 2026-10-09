import type { FormatName } from './formats/format';
import type { FormatSetting } from './formats/registry';
import { parseFormatConfig } from './formats/registry';
import type { GhostCell } from './ghost-types';

export const GHOST_GAPS = ['points', 'rejectedBefore'] as const;
/** What a format needs from a ghost that its source did not give. */
export type GhostGap = (typeof GHOST_GAPS)[number];

const POINT_FORMATS: readonly FormatName[] = ['ioi', 'ioi16'];
const PENALTY_FORMATS: readonly FormatName[] = ['icpc', 'vnoj'];

const penaltyOf = (format: FormatSetting): number =>
  (parseFormatConfig(format.name, format.config) as { penalty: number })
    .penalty;

/** Null: the ghost can be ranked. IOI-style formats rank by points and penalty formats by tries; inventing either would mis-rank people. */
export function ghostGap(
  format: FormatSetting,
  cells: readonly GhostCell[],
): GhostGap | null {
  if (
    POINT_FORMATS.includes(format.name) &&
    cells.some((cell) => cell.points === null)
  )
    return 'points';
  const isPenaltyFormat =
    PENALTY_FORMATS.includes(format.name) && penaltyOf(format) > 0;
  if (isPenaltyFormat && cells.some((cell) => cell.rejectedBefore === null))
    return 'rejectedBefore';
  return null;
}

/** The gap over the cells of the contest's current problems only: a cell of a removed problem neither ranks nor unranks a ghost. The ghost list and the replay both use this, so they agree. */
export const currentGhostGap = (
  format: FormatSetting,
  cells: readonly GhostCell[],
  problemIds: ReadonlySet<string>,
): GhostGap | null =>
  ghostGap(
    format,
    cells.filter((cell) => problemIds.has(cell.problemId)),
  );
