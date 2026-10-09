import type { ScoringContext, ScoringRow } from './formats/format';
import type { FormatSetting } from './formats/registry';
import { currentGhostGap, ghostGap } from './ghost-gap';
import type { GhostGap } from './ghost-gap';
import type { GhostCell, GhostInput } from './ghost-types';
import { replayEvents } from './replay-events';
import type { ReplayEvent } from './replay-events';

export interface GhostSetup {
  format: FormatSetting;
  /** Ghost minutes count from here; also the context's participation and contest start. */
  startTime: Date;
  pointsPrecision: number;
  /** In the replay's problem order. */
  problems: ReadonlyArray<{ problemId: string; points: number }>;
}

export interface GhostReplay {
  label: string;
  caption: string;
  isUnranked: boolean;
  gap: GhostGap | null;
  events: ReplayEvent[];
}

const MINUTE_MS = 60_000;
/** Penalty formats score a solve as full points, whatever a source says. */
const IGNORES_POINTS: readonly string[] = ['icpc', 'vnoj'];
const pad = (value: number): string => String(value).padStart(5, '0');

/** Wrong tries first (smaller ids sort before the solve at the same instant), then the solve: the rows a real participation with these tries would have. */
function rowsOfCell(
  cell: GhostCell,
  index: number,
  problemPoints: number,
  setup: GhostSetup,
): ScoringRow[] {
  // A typo such as 99999@5 must not inflate the board: a solve is worth at most the problem.
  const date = new Date(setup.startTime.getTime() + cell.minute * MINUTE_MS);
  const points = IGNORES_POINTS.includes(setup.format.name)
    ? problemPoints
    : Math.min(cell.points ?? problemPoints, problemPoints);
  const attempt = (
    submissionId: string,
    attemptPoints: number,
  ): ScoringRow => ({
    submissionId,
    problemId: cell.problemId,
    date,
    points: attemptPoints,
    result: attemptPoints > 0 ? 'AC' : 'WA',
    status: 'D',
    batchPoints: setup.format.name === 'ioi16' ? { '0': attemptPoints } : null,
  });
  const wrong = Array.from(
    { length: cell.rejectedBefore ?? 0 },
    (_unused, tryNumber) => attempt(`${pad(index)}-0-${pad(tryNumber)}`, 0),
  );
  return [...wrong, attempt(`${pad(index)}-1`, points)];
}

function contextOf(setup: GhostSetup): ScoringContext {
  return {
    start: setup.startTime,
    contestStart: setup.startTime,
    frozenTime: null,
    pointsPrecision: setup.pointsPrecision,
    // ioi16 scales by problem points over data points: equal, so 1.
    problems: setup.problems.map(({ problemId, points }) => ({
      problemId,
      points,
      dataPoints: points,
    })),
  };
}

/** Ranked ghosts first, then unranked, each group by label: an unranked row never sits among the standings, and the index of an event is its ghost's position in this list. Equal tuples between a ghost and a real row are the SPA's to order: real before ghost. */
export function ghostReplays(
  ghosts: readonly GhostInput[],
  setup: GhostSetup,
): GhostReplay[] {
  const ids = new Set(setup.problems.map((problem) => problem.problemId));
  const isRanked = (ghost: GhostInput): boolean =>
    currentGhostGap(setup.format, ghost.cells, ids) === null;
  const byLabel = [...ghosts].sort((left, right) =>
    left.label < right.label ? -1 : left.label > right.label ? 1 : 0,
  );
  const ordered = [
    ...byLabel.filter(isRanked),
    ...byLabel.filter((ghost) => !isRanked(ghost)),
  ];
  return ordered.map((ghost, index) => ghostReplay(ghost, index, setup));
}

/** A ghost scored through the contest's own `scoreParticipation`, so its numbers share units with real rows. `index` is its `participantIndex`. A ghost the format cannot rank has no events. */
export function ghostReplay(
  ghost: GhostInput,
  index: number,
  setup: GhostSetup,
): GhostReplay {
  const pointsOf = new Map(
    setup.problems.map((problem) => [problem.problemId, problem.points]),
  );
  const cells = ghost.cells.filter((cell) => pointsOf.has(cell.problemId));
  const gap = ghostGap(setup.format, cells);
  const base = { label: ghost.label, caption: ghost.caption, gap };
  if (gap !== null) return { ...base, isUnranked: true, events: [] };
  const rows = cells.flatMap((cell, cellIndex) =>
    rowsOfCell(cell, cellIndex, pointsOf.get(cell.problemId)!, setup),
  );
  const problemIndexes = new Map(
    setup.problems.map((problem, position) => [problem.problemId, position]),
  );
  const events = replayEvents(rows, setup.format, contextOf(setup), {
    participantIndex: index,
    problemIndexes,
  });
  return { ...base, isUnranked: false, events };
}
