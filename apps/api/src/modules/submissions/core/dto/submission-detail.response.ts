import type { CaseStatus, Submission, SubmissionCase } from '@libs/database';
import { batchSummaries } from '../submission-access';
import type { CaseVisibility, SubmissionActions } from '../submission-access';
import { SubmissionListItemResponse } from './submission-list.response';
import type { SubmissionRefs } from './submission-list.response';

export class SubmissionCaseResponse {
  /** Position of the case in judging order. */
  position!: number;
  /** Case verdict: `AC`, `WA`, `TLE`, `MLE`, `OLE`, `IR`, `RTE` or `SC`. */
  status!: CaseStatus;
  /** Running time in seconds. */
  time!: number;
  /** Memory used in KiB. */
  memory!: number;
  /** Points earned by the case. */
  points!: number;
  /** Points available for the case. */
  total!: number;
  /** Batch number, from 1; null for a case outside any batch. */
  batch!: number | null;
  /** Checker feedback; present only when the viewer may see feedback. */
  feedback?: string;
  /** Longer checker feedback; present only when the viewer may see feedback. */
  extendedFeedback?: string;
  /** Program output; present only when the problem shows output to the viewer. */
  output?: string;
}

export class SubmissionBatchResponse {
  /** Batch number, from 1. */
  batch!: number;
  /** Verdict of the first non-accepted case of the batch, or accepted. */
  status!: CaseStatus;
  /** Smallest points of the batch's cases. */
  points!: number;
  /** Largest total of the batch's cases. */
  total!: number;
}

const caseResponse = (
  testCase: SubmissionCase,
  visibility: CaseVisibility,
): SubmissionCaseResponse => ({
  position: testCase.position,
  status: testCase.status,
  time: testCase.time,
  memory: testCase.memory,
  points: testCase.points,
  total: testCase.total,
  batch: testCase.batch,
  ...(visibility.feedback
    ? {
        feedback: testCase.feedback,
        extendedFeedback: testCase.extendedFeedback,
      }
    : {}),
  ...(visibility.output ? { output: testCase.output } : {}),
});

/** What the signed-in viewer may do here; each flag is the rule its action endpoint checks. */
export class SubmissionViewerResponse implements SubmissionActions {
  /** Whether `POST /submissions/{id}/abort` is allowed. */
  canAbort!: boolean;
  /** Whether `POST /submissions/{id}/rejudge` is allowed. */
  canRejudge!: boolean;
  /** Whether `POST /submissions/{id}/reject` is allowed. */
  canReject!: boolean;
}

export class SubmissionDetailResponse extends SubmissionListItemResponse {
  /** Compile log or compiler warnings; the judge's internal error message only for editors. */
  error!: string | null;
  /** Number of the case being judged while the submission runs. */
  currentTestcase!: number;
  /** Whether only the pretests are judged (contest pretest mode). */
  isPretested!: boolean;
  /** Name of the judge that graded it; null when not judged yet. */
  judgedOn!: string | null;
  /** When judging finished; null when not judged yet. */
  judgedDate!: Date | null;
  /** When an admin last rejudged it; null if never. */
  rejudgedDate!: Date | null;
  /** Rejudging is refused after this time. Editors only (the contest's lock setting is staff data); null for everyone else and when the submission never locks. */
  lockedAfter!: Date | null;
  /** Which actions the caller may use on this submission. */
  viewer!: SubmissionViewerResponse;
  /** Every case when the problem shows them (`testcaseResultVisibility` A) or to superusers. */
  cases!: SubmissionCaseResponse[] | null;
  /** Batch summaries when the problem shows only those (B). */
  batches!: SubmissionBatchResponse[] | null;
  /** The problem's test case count; null whenever the viewer may not see case results. */
  totalCases!: number | null;

  static withDetails(
    submission: Submission,
    refs: SubmissionRefs,
    {
      visibility,
      showError,
      totalCases,
      lockedAfter,
      actions,
    }: {
      visibility: CaseVisibility;
      showError: boolean;
      totalCases: number | null;
      lockedAfter: Date | null;
      actions: SubmissionActions;
    },
  ): SubmissionDetailResponse {
    return {
      ...SubmissionListItemResponse.from(submission, refs),
      error: showError ? submission.error : null,
      currentTestcase: submission.currentTestcase,
      isPretested: submission.isPretested,
      judgedOn: submission.judgedOn,
      judgedDate: submission.judgedDate,
      rejudgedDate: submission.rejudgedDate,
      lockedAfter,
      viewer: actions,
      cases:
        visibility.cases === 'all'
          ? submission.cases.map((testCase) =>
              caseResponse(testCase, visibility),
            )
          : null,
      batches:
        visibility.cases === 'batches'
          ? batchSummaries(submission.cases)
          : null,
      totalCases,
    };
  }
}

export class SubmissionSourceResponse {
  /** Submission id. */
  id!: string;
  /** Submitted source text; for a file-only language, the URL of the uploaded file. */
  source!: string;
}
