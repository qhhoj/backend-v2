import type { CaseStatus, Submission, SubmissionCase } from '@libs/database';
import { batchSummaries } from '../submission-access';
import type { CaseVisibility } from '../submission-access';
import { SubmissionListItemResponse } from './submission-list.response';
import type { SubmissionRefs } from './submission-list.response';

export class SubmissionCaseResponse {
  position!: number;
  status!: CaseStatus;
  time!: number;
  memory!: number;
  points!: number;
  total!: number;
  batch!: number | null;
  feedback?: string;
  extendedFeedback?: string;
  output?: string;
}

export class SubmissionBatchResponse {
  batch!: number;
  status!: CaseStatus;
  points!: number;
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

export class SubmissionDetailResponse extends SubmissionListItemResponse {
  /** Compile log or compiler warnings; the judge's internal error message only for editors. */
  error!: string | null;
  currentTestcase!: number;
  isPretested!: boolean;
  judgedOn!: string | null;
  judgedDate!: Date | null;
  rejudgedDate!: Date | null;
  /** Every case when the problem shows them (`testcaseResultVisibility` A) or to superusers. */
  cases!: SubmissionCaseResponse[] | null;
  /** Batch summaries when the problem shows only those (B). */
  batches!: SubmissionBatchResponse[] | null;

  static withDetails(
    submission: Submission,
    refs: SubmissionRefs,
    {
      visibility,
      showError,
    }: { visibility: CaseVisibility; showError: boolean },
  ): SubmissionDetailResponse {
    return {
      ...SubmissionListItemResponse.from(submission, refs),
      error: showError ? submission.error : null,
      currentTestcase: submission.currentTestcase,
      isPretested: submission.isPretested,
      judgedOn: submission.judgedOn,
      judgedDate: submission.judgedDate,
      rejudgedDate: submission.rejudgedDate,
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
    };
  }
}

export class SubmissionSourceResponse {
  id!: string;
  source!: string;
}
