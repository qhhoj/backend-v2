import { hasPermission } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { uuidStr } from '@libs/database';
import type { Problem, Submission } from '@libs/database';
import type { FilterQuery } from 'mongoose';
import { ProblemAccess } from '../../problems/core/problem-access';
import type {
  ContestScope,
  ProblemAccessView,
} from '../../problems/core/problem-access';

/**
 * Which of a problem's submissions the viewer may see. `onlyContest`: the problem is visible only through
 * the viewer's current contest (`ContestScope`), which opens the problem, not its history, so only that
 * contest's submissions and the viewer's own are served (legacy in-contest lists, `contest_object`).
 * `judge.view_all_submission` keeps every row. The contest gates (`hiddenContestClauses`,
 * `isContestListClosed`) still apply on top.
 */
export type ProblemRows = 'all' | 'none' | { onlyContest: ContestScope };

const seesEveryRow = (principal: Principal | null): boolean =>
  principal !== null && hasPermission(principal, 'judge.view_all_submission');

export function problemRowsOf(
  principal: Principal | null,
  problem: ProblemAccessView,
  scope: ContestScope | null,
): ProblemRows {
  if (!ProblemAccess.canSee(principal, problem, scope)) return 'none';
  if (
    scope === null ||
    seesEveryRow(principal) ||
    ProblemAccess.canSee(principal, problem, null)
  )
    return 'all';
  return { onlyContest: scope };
}

/** An `onlyContest` row: one of the scope's contest, or the viewer's own. */
export function isContestRow(
  submission: Pick<Submission, 'user' | 'contest'>,
  scope: ContestScope,
  principal: Principal | null,
): boolean {
  return (
    uuidStr(submission.user) === principal?.userId ||
    (submission.contest != null &&
      uuidStr(submission.contest) === scope.contestId)
  );
}

/** `isContestRow` as a Mongo filter. */
export const contestRowsFilter = (
  scope: ContestScope,
  principal: Principal | null,
): FilterQuery<Submission> => ({
  $or: [
    { contest: scope.contestId },
    ...(principal ? [{ user: principal.userId }] : []),
  ],
});

/** `problemRowsOf` for a whole list: the problems whose every row the viewer sees, and the scope whose remaining problems serve only `contestRowsFilter` rows (null when the list is not narrowed). */
export function listRowsOf(
  principal: Principal | null,
  scope: ContestScope | null,
): { everyRow: FilterQuery<Problem>; contestOnly: ContestScope | null } {
  if (scope === null || !scope.started || seesEveryRow(principal))
    return {
      everyRow: ProblemAccess.visibleFilter(principal, scope),
      contestOnly: null,
    };
  return {
    everyRow: ProblemAccess.visibleFilter(principal, null),
    contestOnly: scope,
  };
}
