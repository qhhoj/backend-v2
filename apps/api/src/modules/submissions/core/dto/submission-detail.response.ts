import { ApiProperty } from '@nestjs/swagger';
import type { CaseStatus, Submission, SubmissionCase } from '@libs/database';
import { batchSummaries, SOURCE_ACCESS } from '../submission-access';
import type {
  CaseVisibility,
  SourceAccess,
  SubmissionActions,
} from '../submission-access';
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

/** What the viewer may do here; each flag is the rule its action endpoint checks. All false for visitors. */
export class SubmissionViewerResponse implements SubmissionActions {
  /** Whether `POST /submissions/{id}/abort` is allowed. */
  canAbort!: boolean;
  /** Whether `POST /submissions/{id}/rejudge` is allowed. */
  canRejudge!: boolean;
  /** Whether `POST /submissions/{id}/reject` is allowed. */
  canReject!: boolean;
  /** Whether `POST` and `DELETE /submissions/{id}/lock` are allowed. */
  canLock!: boolean;
  /** Whether `PUT /submissions/{id}/score` is allowed. */
  canOverrideScore!: boolean;
}

export class SubmissionExternalRunResponse {
  /** The external judge's OJ. */
  oj!: string;
  /** The problem id on that OJ. */
  problemId!: string;
  /** The external judge's submission id; null until it accepted the submit. */
  remoteId!: string | null;
  /** The external judge's own status (`queued`, `done`, ...). */
  systemStatus!: string;
  /** The remote verdict (`AC`, `WA`, `PENDING`, ...). */
  statusCanonical!: string;
  /** The remote score, as text (`100/100`). */
  scoreText!: string | null;
  /** Link to the run on the remote OJ. */
  remoteUrl!: string | null;
  /** When the run was sent; null until then. */
  submittedAt!: Date | null;
}

export class SubmissionContestResponse {
  /** The contest's key. */
  key!: string;
  /** The contest's name. */
  name!: string;
  /** Points this submission scored in the contest (the case ratio of the contest problem's points, as the scoreboard counts them); null when the problem left the contest and no contest row holds them. */
  points!: number | null;
  /** Whole minutes from the start of the run it was made in to the submission, as the scoreboard counts them (`participationStart`); only for the submitter's own submission made within that run, null otherwise. */
  minute!: number | null;
}

export class SubmissionDetailResponse extends SubmissionListItemResponse {
  /** Compile log or compiler warnings, only for a viewer who may read the source (`sourceAccess` granted: a compile log quotes the code); an internal error's message (it can quote jury data) only for the problem's editors, null for everyone else, the submitter included. */
  error!: string | null;
  /** Whether `GET /submissions/{id}/source` will answer: `granted`; `sign_in` for visitors; `solve_first` until the viewer solves the problem; `hidden` otherwise. Without source access, cases carry no feedback or output. */
  @ApiProperty({ enum: SOURCE_ACCESS, enumName: 'SubmissionSourceAccess' })
  sourceAccess!: SourceAccess;
  /** Number of the case being judged while the submission runs; null unless the viewer sees every case result (it would tell where judging stopped). */
  currentTestcase!: number | null;
  /** Whether only the pretests are judged (contest pretest mode). */
  isPretested!: boolean;
  /** Name of the judge that graded it; null when not judged yet. */
  judgedOn!: string | null;
  /** When judging finished; null when not judged yet. */
  judgedDate!: Date | null;
  /** When an admin last rejudged it; null if never. */
  rejudgedDate!: Date | null;
  /** Rejudging is refused after this time (a lock). Editors only (the contest's lock setting is staff data); null for everyone else and when the submission never locks. */
  lockedAfter!: Date | null;
  /** Which actions the caller may use on this submission. */
  viewer!: SubmissionViewerResponse;
  /** Every case when the problem shows them (`testcaseResultVisibility` A) or to superusers. */
  cases!: SubmissionCaseResponse[] | null;
  /** Batch summaries when the problem shows only those (B). */
  batches!: SubmissionBatchResponse[] | null;
  /** The run on the external judge; only for viewers who may rejudge, and only for the current judging generation. */
  externalRun!: SubmissionExternalRunResponse | null;
  /** The problem's test case count; null whenever the viewer may not see case results. */
  totalCases!: number | null;
  /** The contest it was submitted in, when the viewer may see that contest; null otherwise and outside a contest. */
  contest!: SubmissionContestResponse | null;

  static withDetails(
    submission: Submission,
    refs: SubmissionRefs,
    {
      visibility,
      error,
      sourceAccess,
      totalCases,
      lockedAfter,
      actions,
      externalRun,
      contest,
    }: {
      visibility: CaseVisibility;
      /** `shownError` for this viewer. */
      error: string | null;
      sourceAccess: SourceAccess;
      totalCases: number | null;
      lockedAfter: Date | null;
      actions: SubmissionActions;
      externalRun: SubmissionExternalRunResponse | null;
      contest: SubmissionContestResponse | null;
    },
  ): SubmissionDetailResponse {
    return {
      ...SubmissionListItemResponse.from(submission, refs),
      error,
      sourceAccess,
      currentTestcase:
        visibility.cases === 'all' ? submission.currentTestcase : null,
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
      externalRun,
      totalCases,
      contest,
    };
  }
}

export class SubmissionSourceResponse {
  /** Submission id. */
  id!: string;
  /** Submitted source text; for a file-only language, the URL of the uploaded file. */
  source!: string;
  /** Name the raw and download links give the file (`<id>.<extension>`, `Main.java` for Java); null for a file-only language. */
  filename!: string | null;
}
