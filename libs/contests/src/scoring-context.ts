import { uuidStr } from '@libs/database';
import { frozenTime, participationStart } from './contest-time';
import type { ContestTimes, ParticipationTimes } from './contest-time';
import type { ScoringContext } from './formats/format';

export interface ScoringContestFields extends ContestTimes {
  pointsPrecision: number;
  /** `problem` may be a BSON UUID on a lean read; `uuidStr` normalises it. */
  problems: ReadonlyArray<{ problem: string; points: number }>;
}

/** What every format needs to score one participation. The recompute and the replay build both come here, so they cannot drift. `dataPointsOf` is ioi16's divisor per problem id. */
export function scoringContextOf(
  contest: ScoringContestFields,
  participation: ParticipationTimes,
  dataPointsOf: ReadonlyMap<string, number>,
): ScoringContext {
  return {
    start: participationStart(contest, participation),
    contestStart: contest.startTime,
    frozenTime: frozenTime(contest),
    pointsPrecision: contest.pointsPrecision,
    problems: contest.problems.map((entry) => ({
      problemId: uuidStr(entry.problem),
      points: entry.points,
      dataPoints: dataPointsOf.get(uuidStr(entry.problem)) ?? null,
    })),
  };
}
