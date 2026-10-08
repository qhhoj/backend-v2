import { isSolvedCell } from '@libs/contests';
import type { ProblemCell } from '@libs/contests';
import {
  UNCOUNTED_ATTEMPT_STATUSES,
  UNFINISHED_STATUSES,
} from '@libs/database';
import type { SubmissionStatus } from '@libs/database';
import type { ContestProblemViewerResultResponse } from './dto/contest-detail.response';

/** Still waiting for a verdict: queued, judging, or held for final judging (FSO). */
const AWAITING_VERDICT_STATUSES: readonly SubmissionStatus[] = [
  ...UNFINISHED_STATUSES,
  'PD',
];

export interface OwnSubmission {
  problem: string;
  status: SubmissionStatus;
}

export interface ViewerResultInput {
  problems: readonly { problemId: string; points: number }[];
  /** The viewer's cells as the board shows them to the viewer (`standingOf`). */
  cells: Record<string, ProblemCell>;
  submissions: readonly OwnSubmission[];
}

const isCountedAttempt = (submission: OwnSubmission) =>
  !UNCOUNTED_ATTEMPT_STATUSES.includes(submission.status);
const isAwaitingVerdict = (submission: OwnSubmission) =>
  AWAITING_VERDICT_STATUSES.includes(submission.status);

/** Per problem id, the viewer's own result; every problem of the contest has an entry. */
export function viewerProblemResults({
  problems,
  cells,
  submissions,
}: ViewerResultInput): Map<string, ContestProblemViewerResultResponse> {
  return new Map(
    problems.map(({ problemId, points }) => {
      const own = submissions.filter(
        (submission) => submission.problem === problemId,
      );
      const cell = cells[problemId] ?? null;
      return [
        problemId,
        {
          cell,
          isSolved: isSolvedCell(cell, points),
          attempts: own.filter(isCountedAttempt).length,
          hasPendingSubmission: own.some(isAwaitingVerdict),
        },
      ];
    }),
  );
}
