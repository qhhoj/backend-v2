import { hasPermission } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { IN_FLIGHT_STATUSES, UNFINISHED_STATUSES } from '@libs/database';
import type {
  CaseStatus,
  Submission,
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

/** Whether the viewer may read a submission's source: `sign_in` for visitors, `solve_first` until an `if-solved` viewer has solved the problem, `hidden` when `detailAccess` denies it. */
export const SOURCE_ACCESS = [
  'granted',
  'sign_in',
  'solve_first',
  'hidden',
] as const;
export type SourceAccess = (typeof SOURCE_ACCESS)[number];

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

/** Legacy `Submission.can_see_detail`; contest editors see every submission of their contest, and a suggester only on problems they may edit (`canEdit`), not the whole suggestion pool. `if-solved`: granted once the viewer has solved the problem (`IS_SOLVED`: every case point earned). */
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
  if (ownerId === principal.userId) return 'granted';
  const visibility = sourceVisibilityOf(problem);
  const isTester = problem.testers.includes(principal.userId);
  if (visibility === 'A' || (visibility === 'O' && isTester)) return 'granted';
  return visibility === 'S' && (problem.isPublic || isTester)
    ? 'if-solved'
    : 'denied';
}

/** The source rule on top of `detailAccess`: never for visitors, and an `if-solved` grant needs the viewer to have solved the problem (`hasSolved`, by `IS_SOLVED`). */
export function sourceAccessOf(
  principal: Principal | null,
  access: DetailAccess,
  hasSolved: boolean,
): SourceAccess {
  if (!principal) return 'sign_in';
  if (access === 'granted' || (access === 'if-solved' && hasSolved))
    return 'granted';
  return access === 'if-solved' ? 'solve_first' : 'hidden';
}

export interface CaseVisibility {
  cases: 'all' | 'batches' | 'none';
  feedback: boolean;
  output: boolean;
}

/** Legacy status page: superusers and `A` see every case, `B` batch summaries, `S` only the totals; feedback for superusers, editors or `allowViewFeedback`; program output unless `testcaseVisibility` is O (authors and editors only; A = always, C = outside contests, `isInContest`). Feedback and output describe what the code did on the jury's data, so a viewer who may not read the source (`readsSource` false, visitors included) gets neither. */
export function caseVisibility(
  principal: Principal | null,
  problem: {
    testcaseResultVisibility: string;
    testcaseVisibility: string;
    allowViewFeedback: boolean;
  },
  {
    canEdit,
    isInContest,
    readsSource,
  }: { canEdit: boolean; isInContest: boolean; readsSource: boolean },
): CaseVisibility {
  return {
    cases:
      principal?.isSuperuser || problem.testcaseResultVisibility === 'A'
        ? 'all'
        : problem.testcaseResultVisibility === 'B'
          ? 'batches'
          : 'none',
    feedback:
      readsSource &&
      (principal?.isSuperuser === true || canEdit || problem.allowViewFeedback),
    output:
      readsSource &&
      (canEdit ||
        problem.testcaseVisibility === 'A' ||
        (problem.testcaseVisibility === 'C' && !isInContest)),
  };
}

/** An internal error's `error` is the judge's own message, which can quote jury data (a checker's `FAIL` line). */
export const isInternalError = ({
  status,
  result,
}: Pick<Submission, 'status' | 'result'>): boolean =>
  status === 'IE' || result === 'IE';

/** The only gate on a submission's `error` text: an internal error's message reaches the problem's editors alone (`ProblemAccess.canEdit`, the staff-actions rule), even the submitter sees null; a compile log or compiler warnings reach whoever may see the submission. */
export const shownError = (
  submission: Pick<Submission, 'status' | 'result' | 'error'>,
  canEdit: boolean,
): string | null =>
  canEdit || !isInternalError(submission) ? submission.error : null;

/** What a list row shows of a submission's test results: every case, the batch summaries, or nothing. */
export type ListCaseUnit = 'case' | 'batch';

export interface ListCaseFacts {
  ownerId: string;
  /** The submission was made in a contest. */
  inContest: boolean;
  problem: SubmissionProblemView & {
    testcaseResultVisibility: string;
    testcaseVisibility: string;
    allowViewFeedback: boolean;
    isDeleted: boolean;
  };
  canEdit: boolean;
}

/**
 * The submission page's case rule for one list row, kept narrower where a row cannot be checked cheaply: signed-in
 * viewers only, `if-solved` counts as denied, and another user's contest submission shows nothing to anyone but the
 * problem's editors and `judge.view_all_submission` (the detail page would also need the contest's list open and not
 * frozen, which the list does not look up per row). Do not loosen this without adding that contest check.
 */
export function listCaseUnit(
  principal: Principal | null,
  { ownerId, inContest, problem, canEdit }: ListCaseFacts,
): ListCaseUnit | null {
  if (!principal || problem.isDeleted) return null;
  const { cases } = caseVisibility(principal, problem, {
    canEdit,
    isInContest: false,
    readsSource: false,
  });
  if (cases === 'none') return null;
  const access = detailAccess(principal, {
    ownerId,
    problem,
    canEdit,
    isContestEditor: false,
  });
  if (access !== 'granted') return null;
  const seesEveryRow =
    canEdit || hasPermission(principal, 'judge.view_all_submission');
  if (inContest && ownerId !== principal.userId && !seesEveryRow) return null;
  return cases === 'all' ? 'case' : 'batch';
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
  canOverrideScore: boolean;
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

/** Legacy submission admin (`judge.change_submission`) with edit rights on the problem: the manual score override. */
export const mayOverrideSubmissionScore = (
  principal: Principal,
  canEditProblem: boolean,
): boolean =>
  canEditProblem && hasPermission(principal, 'judge.change_submission');

/** Queued, judged or a pending final submission: no manual score may replace what judging will write. */
export const NOT_OVERRIDABLE_STATUSES: readonly SubmissionStatus[] = [
  ...UNFINISHED_STATUSES,
  'PD',
];

export const isScoreOverridable = (status: SubmissionStatus): boolean =>
  !NOT_OVERRIDABLE_STATUSES.includes(status);

/** A rejudge is refused for pending final-submission rows and for submissions a judge holds. */
const isRejudgeableStatus = (status: SubmissionStatus): boolean =>
  status !== 'PD' && !IN_FLIGHT_STATUSES.includes(status);

/** The action flags a viewer may use on one submission; each is the rule its action endpoint checks. A visitor may use none. */
export function submissionActions(
  principal: Principal | null,
  facts: SubmissionActionFacts,
  now = new Date(),
): SubmissionActions {
  if (!principal)
    return {
      canAbort: false,
      canRejudge: false,
      canReject: false,
      canLock: false,
      canOverrideScore: false,
    };
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
    canOverrideScore:
      mayOverrideSubmissionScore(principal, facts.canEditProblem) &&
      isScoreOverridable(facts.status),
  };
}
