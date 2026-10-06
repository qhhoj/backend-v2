import { hasPermission } from '@libs/auth';
import type { Principal } from '@libs/auth';
import type { CaseStatus, SubmissionCase } from '@libs/database';
import type { ProblemAccessView } from '../problems/problem-access';

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

/** Legacy `Submission.can_see_detail` (contest editors arrive with sub-project 4). `if-solved`: granted once the viewer has an AC worth the problem's full points. */
export function detailAccess(
  principal: Principal,
  ownerId: string,
  problem: SubmissionProblemView,
  canEdit: boolean,
): DetailAccess {
  if (canEdit || hasPermission(principal, 'judge.view_all_submission'))
    return 'granted';
  if (
    !problem.isPublic &&
    problem.suggester !== null &&
    hasPermission(principal, 'judge.suggest_new_problem')
  )
    return 'granted';
  if (ownerId === principal.userId) return 'granted';
  const visibility =
    problem.submissionSourceVisibility === 'F'
      ? SITE_SOURCE_VISIBILITY
      : problem.submissionSourceVisibility;
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

/** Legacy status page: superusers and `A` see every case, `B` batch summaries, `S` only the totals; feedback for superusers, editors or `allowViewFeedback`; program output unless `testcaseVisibility` is O (authors and editors only; A = always, C = outside contests, and 2a has no contests). */
export function caseVisibility(
  principal: Principal,
  problem: {
    testcaseResultVisibility: string;
    testcaseVisibility: string;
    allowViewFeedback: boolean;
  },
  canEdit: boolean,
): CaseVisibility {
  return {
    cases:
      principal.isSuperuser || problem.testcaseResultVisibility === 'A'
        ? 'all'
        : problem.testcaseResultVisibility === 'B'
          ? 'batches'
          : 'none',
    feedback: principal.isSuperuser || canEdit || problem.allowViewFeedback,
    output: canEdit || problem.testcaseVisibility !== 'O',
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
