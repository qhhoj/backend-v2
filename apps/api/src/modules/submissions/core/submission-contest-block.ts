import {
  contestSubmissionPoints,
  participationEnd,
  participationStart,
} from '@libs/contests';
import type { ParticipationTimes } from '@libs/contests';
import { uuidStr } from '@libs/database';
import type { Contest, Submission } from '@libs/database';
import type { SubmissionContestResponse } from './dto/submission-list.response';
import type { ContestRowFields } from './submissions.repository';

const MINUTE_MS = 60_000;

/** What the contest block reads once loaded; the viewer's right to see the contest is decided before. */
export interface ContestBlockFacts {
  contest: Contest;
  /** Whether the problem scores partially (a contest problem is partial only when it is too). */
  problemPartial: boolean;
  /** The submission's contest row; `undefined` when it has none. */
  row: ContestRowFields | undefined;
  /** The run it was made in, given only for the submitter's own submission (the minute is theirs to see); `undefined` otherwise. */
  run: ParticipationTimes | undefined;
}

/** The contest, the points there and the run minute. The points are worked out as the worker stores them (`contestSubmissionPoints`), so a result read right after judging does not race the worker; a problem no longer in the contest keeps its stored points. */
export function contestBlock(
  submission: Submission,
  { contest, problemPartial, row, run }: ContestBlockFacts,
): SubmissionContestResponse {
  const contestProblem = contest.problems.find(
    (entry) => uuidStr(entry.problem) === uuidStr(submission.problem),
  );
  const points = contestProblem
    ? contestSubmissionPoints(
        submission,
        contestProblem,
        contest.formatName,
        problemPartial,
      )
    : (row?.points ?? null);
  return {
    key: contest.key,
    name: contest.name,
    points,
    minute: run ? runMinute(submission, contest, run) : null,
  };
}

/** Whole minutes from the run's start (`participationStart`, the scoreboard's) to the submission; null outside that run. */
function runMinute(
  submission: Submission,
  contest: Contest,
  run: ParticipationTimes,
): number | null {
  const start = participationStart(contest, run);
  const isWithin =
    submission.date >= start &&
    submission.date <= participationEnd(contest, run);
  return isWithin
    ? Math.floor((submission.date.getTime() - start.getTime()) / MINUTE_MS)
    : null;
}
