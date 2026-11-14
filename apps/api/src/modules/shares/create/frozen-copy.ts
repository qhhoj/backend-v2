import { SHAREABLE_STATUSES, uuidStr } from '@libs/database';
import type {
  Problem,
  ShareCase,
  ShareCopy,
  Submission,
  SubmissionCase,
} from '@libs/database';
import {
  batchSummaries,
  caseVisibility,
  isInternalError,
} from '../../submissions/core/submission-access';
import type { CaseVisibility } from '../../submissions/core/submission-access';

/** A compile log is the author's own compiler output; long ones are cut. */
export const COMPILE_LOG_MAX_LENGTH = 8192;

export interface CopySource {
  submission: Pick<
    Submission,
    | '_id'
    | 'problem'
    | 'contest'
    | 'status'
    | 'result'
    | 'error'
    | 'points'
    | 'casePoints'
    | 'caseTotal'
    | 'time'
    | 'memory'
    | 'date'
    | 'judgedDate'
  > & { cases?: SubmissionCase[] };
  problem: Pick<
    Problem,
    | 'points'
    | 'testcaseResultVisibility'
    | 'testcaseVisibility'
    | 'allowViewFeedback'
    | 'deletedAt'
  >;
  /** The problem's case count, when its cases or batches are shown. */
  caseCount: number | null;
}

/** Only a finished run may be copied: judged (`D`) or failed to compile (`CE`), never an internal error, an abort or a held final submission. */
export const isShareable = (
  submission: Pick<Submission, 'status' | 'result'>,
): boolean =>
  (SHAREABLE_STATUSES as readonly string[]).includes(submission.status) &&
  !isInternalError(submission);

/** The visitor's case rule (no edit rights, no source access), so a problem that hides case results keeps hiding them; a deleted problem shows totals only. */
export const copyCaseUnit = (
  problem: CopySource['problem'],
): CaseVisibility['cases'] =>
  problem.deletedAt
    ? 'none'
    : caseVisibility(null, problem, {
        canEdit: false,
        isInContest: false,
        readsSource: false,
      }).cases;

/** Allow-listed fields only: never feedback, extended feedback or program output, which quote jury data. */
const caseOf = (testCase: SubmissionCase): ShareCase => ({
  position: testCase.position,
  status: testCase.status,
  time: testCase.time,
  memory: testCase.memory,
  points: testCase.points,
  total: testCase.total,
  batch: testCase.batch,
});

/** The least-privileged view of a shareable submission (`isShareable`), stored as is. */
export function frozenCopyOf({
  submission,
  problem,
  caseCount,
}: CopySource): ShareCopy {
  const unit = copyCaseUnit(problem);
  const cases = submission.cases ?? [];
  return {
    submissionId: uuidStr(submission._id),
    problem: uuidStr(submission.problem),
    contest: submission.contest ? uuidStr(submission.contest) : null,
    status: submission.status as ShareCopy['status'],
    result: submission.result,
    points: submission.points,
    problemPoints: problem.points,
    casePoints: submission.casePoints,
    caseTotal: submission.caseTotal,
    time: submission.time,
    memory: submission.memory,
    submittedAt: submission.date,
    judgedAt: submission.judgedDate,
    cases: unit === 'all' ? cases.map(caseOf) : null,
    batches: unit === 'batches' ? batchSummaries(cases) : null,
    caseCount: unit === 'none' ? null : caseCount,
    compileLog:
      submission.status === 'CE' && submission.error
        ? submission.error.slice(0, COMPILE_LOG_MAX_LENGTH)
        : null,
  };
}
