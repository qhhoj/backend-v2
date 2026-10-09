import type { ProblemCell, ScoringContext, ScoringRow } from './formats/format';
import { scoreParticipation } from './formats/registry';
import type { FormatSetting } from './formats/registry';
import { byDateThenId, secondsSince } from './formats/shared';

/** Bump when the tuple shape or its meaning changes: a head of another version is rebuilt, never served. */
export const REPLAY_FORMAT_VERSION = 1;
/** Events per stored chunk document: well under the 16 MB document limit, and no cap on the total. */
export const REPLAY_CHUNK_EVENTS = 5000;
/** Safety valve, not a product cap: a build of more events fails and the previous head stays. Rescoring is O(rows^2) per participation. */
export const REPLAY_MAX_EVENTS = 2_000_000;

/** The participant's totals after the submission is scored; times are seconds from that participation's own start. */
export type ReplayEvent = [
  seconds: number,
  participantIndex: number,
  problemIndex: number,
  cell: ProblemCell,
  score: number,
  cumtime: number,
  tiebreaker: number,
];

export interface ReplayTarget {
  participantIndex: number;
  /** Problem id to its position in the replay's problem list. */
  problemIndexes: ReadonlyMap<string, number>;
}

/** The last row of a run of rows on one problem at one instant: only that state is observable. */
function endsGroup(rows: readonly ScoringRow[], index: number): boolean {
  const [row, next] = [rows[index], rows[index + 1]];
  return (
    next === undefined ||
    next.problemId !== row.problemId ||
    next.date.getTime() !== row.date.getTime()
  );
}

function eventAfter(
  prefix: readonly ScoringRow[],
  format: FormatSetting,
  context: ScoringContext,
  target: ReplayTarget,
): ReplayEvent {
  const last = prefix.at(-1)!;
  const score = scoreParticipation(prefix, format, context);
  return [
    Math.max(0, secondsSince(context.start, last.date)),
    target.participantIndex,
    target.problemIndexes.get(last.problemId)!,
    score.formatData[last.problemId] ?? {},
    score.score,
    score.cumtime,
    score.tiebreaker,
  ];
}

/** The real pure `scoreParticipation` on each growing prefix of the participation's submissions, oldest first, so the replay is the format's own arithmetic. Rows of problems outside `target` are ignored. */
export function replayEvents(
  rows: readonly ScoringRow[],
  format: FormatSetting,
  context: ScoringContext,
  target: ReplayTarget,
): ReplayEvent[] {
  const ordered = rows
    .filter((row) => target.problemIndexes.has(row.problemId))
    .sort(byDateThenId);
  return ordered.flatMap((_row, index) =>
    endsGroup(ordered, index)
      ? [eventAfter(ordered.slice(0, index + 1), format, context, target)]
      : [],
  );
}

/** One time-ordered stream from the per-participant streams. Ties break by participant only: the sort is stable, so one participant's same-second events keep their submission order (never reordered by problem). */
export const mergeEvents = (streams: readonly ReplayEvent[][]): ReplayEvent[] =>
  streams
    .flat()
    .sort((left, right) => left[0] - right[0] || left[1] - right[1]);

export function chunkEvents(
  events: readonly ReplayEvent[],
  size = REPLAY_CHUNK_EVENTS,
): ReplayEvent[][] {
  return Array.from(
    { length: Math.ceil(events.length / size) },
    (_unused, chunk) => events.slice(chunk * size, (chunk + 1) * size),
  );
}
