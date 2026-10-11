import { hasPermission } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { IN_FLIGHT_STATUSES, UNFINISHED_STATUSES } from '@libs/database';
import type {
  CaseStatus,
  SubmissionCase,
  SubmissionStatus,
} from '@libs/database';
import type { ProblemAccessView } from '../../problems/core/problem-access';

/** Legacy `DMOJ_SUBMISSION_SOURCE_VISIBILITY = 'all-solved'`: what a problem's `F` (follow the site) means. */
export const SITE_SOURCE_VISIBILITY = 'S';
/** Legacy `get_searchable_status_codes`: only staff may filter by these. */
const STAFF_ONLY_CODES: ReadonlySet<string> = new Set([
  'IE',
  'QU',
  'P',
  'G',
  'D',
  'SC',
]);

export type DetailAccess = 'granted' | 'denied' | 'if-solved';

export interface SubmissionProblemView extends ProblemAccessView {
  submissionSourceVisibility: string;
}

export interface DetailAccessFacts {
  ownerId: string;
  problem: SubmissionProblemView;
  canEdit: boolean;
  /** Edits the submission's contest (or every contest). */
  isContestEditor: boolean;
}

/** A problem's `F` follows the site setting. */
const sourceVisibilityOf = (problem: SubmissionProblemView): string =>
  problem.submissionSourceVisibility === 'F'
    ? SITE_SOURCE_VISIBILITY
    : problem.submissionSourceVisibility;

/** Legacy `Submission.can_see_detail`; contest editors see every submission of their contest. `if-solved`: granted once the viewer has an AC worth the problem's full points. */
export function detailAccess(
  principal: Principal,
  { ownerId, problem, canEdit, isContestEditor }: DetailAccessFacts,
): DetailAccess {
  if (
    canEdit ||
    isContestEditor ||
    hasPermission(principal, 'judge.view_all_submission')
  )
    return 'granted';
  if (
    !problem.isPublic &&
    problem.suggester !== null &&
    hasPermission(principal, 'judge.suggest_new_problem')
  )
    return 'granted';
  if (ownerId === principal.userId) return 'granted';
  const visibility = sourceVisibilityOf(problem);
  const isTester = problem.testers.includes(principal.userId);
  if (visibility === 'A' || (visibility === 'O' && isTester)) return 'granted';
  return visibility === 'S' && (problem.isPublic || isTester)
    ? 'if-solved'
    : 'denied';
}

export interface CaseVisibility {
  cases: 'all' | 'batches' | 'none';
  feedback: boolean;
  output: boolean;
}

/** Legacy status page: superusers and `A` see every case, `B` batch summaries, `S` only the totals; feedback for superusers, editors or `allowViewFeedback`; program output unless `testcaseVisibility` is O (authors and editors only; A = always, C = outside contests, `isInContest`). */
export function caseVisibility(
  principal: Principal,
  problem: {
    testcaseResultVisibility: string;
    testcaseVisibility: string;
    allowViewFeedback: boolean;
  },
  { canEdit, isInContest }: { canEdit: boolean; isInContest: boolean },
): CaseVisibility {
  return {
    cases:
      principal.isSuperuser || problem.testcaseResultVisibility === 'A'
        ? 'all'
        : problem.testcaseResultVisibility === 'B'
          ? 'batches'
          : 'none',
    feedback: principal.isSuperuser || canEdit || problem.allowViewFeedback,
    output:
      canEdit ||
      problem.testcaseVisibility === 'A' ||
      (problem.testcaseVisibility === 'C' && !isInContest),
  };
}

export interface BatchSummary {
  batch: number;
  status: CaseStatus;
  points: number;
  total: number;
}

/** Legacy `make_batch`: per batch the smallest points, the largest total and the first non-AC status. */
export function batchSummaries(
  cases: readonly SubmissionCase[],
): BatchSummary[] {
  const batches = new Map<number, SubmissionCase[]>();
  for (const testCase of cases) {
    if (testCase.batch === null) continue;
    const members = batches.get(testCase.batch) ?? [];
    members.push(testCase);
    batches.set(testCase.batch, members);
  }
  return [...batches].map(([batch, members]) => ({
    batch,
    status: (members.find((member) => member.status !== 'AC') ?? members[0])
      .status,
    points: Math.min(...members.map((member) => member.points)),
    total: Math.max(...members.map((member) => member.total)),
  }));
}

/** The list filter field that holds a staff-only code, for everyone but staff and superusers. */
export function staffOnlyFilter(
  principal: Principal | null,
  filters: { result?: readonly string[]; status?: readonly string[] },
): 'result' | 'status' | null {
  if (principal?.isStaff || principal?.isSuperuser) return null;
  if (filters.result?.some((code) => STAFF_ONLY_CODES.has(code)))
    return 'result';
  return filters.status?.some((code) => STAFF_ONLY_CODES.has(code))
    ? 'status'
    : null;
}

export const isSubmissionLocked = (
  lockedAfter: Date | null,
  now = new Date(),
): boolean => lockedAfter !== null && lockedAfter < now;

export interface SubmissionActionFacts {
  isOwner: boolean;
  status: SubmissionStatus;
  rejudgedDate: Date | null;
  lockedAfter: Date | null;
  /** `ProblemAccess.canEdit` on the submission's problem (no contest scope). */
  canEditProblem: boolean;
}

export interface SubmissionActions {
  canAbort: boolean;
  canRejudge: boolean;
  canReject: boolean;
  canLock: boolean;
}

/** Legacy `abort_submission`: `judge.abort_any_submission`, or the owner until an admin rejudges the submission. */
export const mayAbortSubmission = (
  principal: Principal,
  {
    isOwner,
    rejudgedDate,
  }: Pick<SubmissionActionFacts, 'isOwner' | 'rejudgedDate'>,
): boolean =>
  hasPermission(principal, 'judge.abort_any_submission') ||
  (isOwner && rejudgedDate === null);

/** Legacy `is_rejudgeable_by`: the permission and edit rights on the problem. */
export const mayRejudgeSubmission = (
  principal: Principal,
  canEditProblem: boolean,
): boolean =>
  canEditProblem && hasPermission(principal, 'judge.rejudge_submission');

/** Legacy `is_rejectable_by`: the permission and edit rights on the problem. */
export const mayRejectSubmission = (
  principal: Principal,
  canEditProblem: boolean,
): boolean =>
  canEditProblem && hasPermission(principal, 'judge.reject_submission');

/** Legacy `judge.lock_submission` on the submission form, with edit rights on the problem. */
export const mayLockSubmission = (
  principal: Principal,
  canEditProblem: boolean,
): boolean =>
  canEditProblem && hasPermission(principal, 'judge.lock_submission');

/** A rejudge is refused for pending final-submission rows and for submissions a judge holds. */
const isRejudgeableStatus = (status: SubmissionStatus): boolean =>
  status !== 'PD' && !IN_FLIGHT_STATUSES.includes(status);

/** The action flags a viewer may use on one submission; each is the rule its action endpoint checks. */
export function submissionActions(
  principal: Principal,
  facts: SubmissionActionFacts,
  now = new Date(),
): SubmissionActions {
  return {
    canAbort:
      UNFINISHED_STATUSES.includes(facts.status) &&
      mayAbortSubmission(principal, facts),
    canRejudge:
      mayRejudgeSubmission(principal, facts.canEditProblem) &&
      !isSubmissionLocked(facts.lockedAfter, now) &&
      isRejudgeableStatus(facts.status),
    canReject:
      mayRejectSubmission(principal, facts.canEditProblem) &&
      !UNFINISHED_STATUSES.includes(facts.status),
    canLock: mayLockSubmission(principal, facts.canEditProblem),
  };
}
