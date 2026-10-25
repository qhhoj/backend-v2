import { uuidStr } from '@libs/database';
import { frozenTime, participationStart } from './contest-time';
import type { ContestTimes, ParticipationTimes } from './contest-time';
import type { ScoringContext } from './formats/format';

/** ioi16's divisors of one problem: of a full run (`dataPoints`) and of a pretest-only run (`allDataPoints`). */
export interface RunDivisors {
  dataPoints: number;
  allDataPoints: number;
}

export interface ScoringContestFields extends ContestTimes {
  pointsPrecision: number;
  /** `problem` may be a BSON UUID on a lean read; `uuidStr` normalises it. */
  problems: ReadonlyArray<{ problem: string; points: number }>;
}

/** What every format needs to score one participation. The recompute and the replay build both come here, so they cannot drift. `divisorsOf` holds ioi16's divisors per problem id. */
export function scoringContextOf(
  contest: ScoringContestFields,
  participation: ParticipationTimes,
  divisorsOf: ReadonlyMap<string, RunDivisors>,
): ScoringContext {
  return {
    start: participationStart(contest, participation),
    contestStart: contest.startTime,
    frozenTime: frozenTime(contest),
    pointsPrecision: contest.pointsPrecision,
    problems: contest.problems.map((entry) => ({
      problemId: uuidStr(entry.problem),
      points: entry.points,
      ...(divisorsOf.get(uuidStr(entry.problem)) ?? { dataPoints: null }),
    })),
  };
}
