import { ApiProperty } from '@nestjs/swagger';
import type { UserDocument } from '@libs/auth';
import {
  CASE_STATUSES,
  SUBMISSION_RESULTS,
  SUBMISSION_STATUSES,
  uuidStr,
} from '@libs/database';
import type {
  CaseStatus,
  Language,
  Problem,
  Submission,
  SubmissionResult,
  SubmissionStatus,
} from '@libs/database';
import { UserSummaryResponse } from '../../../problems/core/dto/user-summary.response';
import type { TestSummary } from '../test-summary';

export class SubmissionProblemResponse {
  /** Problem code. */
  code!: string;
  /** Problem title. */
  name!: string;
  /** The problem's max points: the denominator of a submission's score. */
  points!: number;
  /** The problem was deleted or purged; its name is kept. */
  isDeleted!: boolean;
}

export class SubmissionLanguageResponse {
  /** Language id. */
  id!: string;
  /** Key judges report for the language. */
  key!: string;
  /** Display name. */
  name!: string;
}

export class SubmissionTestSummaryResponse {
  /** `case`: one entry per test case in judging order; `batch`: one entry per batch (the problem shows only batch results). */
  @ApiProperty({ enum: ['case', 'batch'] })
  unit!: 'case' | 'batch';
  /** Verdict of each entry, at most 100: `AC`, `WA`, `TLE`, `MLE`, `OLE`, `IR`, `RTE` or `SC`. For `batch`, the first non-accepted case of each batch among the first 100 cases. */
  @ApiProperty({ enum: CASE_STATUSES, isArray: true })
  statuses!: CaseStatus[];
  /** Batch number of each entry, from 1; null for a case outside any batch. Same length as `statuses`. */
  @ApiProperty({
    type: 'array',
    items: { type: 'number', nullable: true },
  })
  batches!: (number | null)[];
  /** Judged cases past the first 100, not in `statuses`. */
  more!: number;
  /** The problem's test case count for `case` (the rest are not judged yet); null for `batch`. */
  total!: number | null;
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

/** The rows resolved for one submission; a missing one renders as null. */
export interface SubmissionRefs {
  user: UserDocument | undefined;
  problem: Pick<Problem, 'code' | 'name' | 'points' | 'deletedAt'> | undefined;
  language: Language | null;
}

export class SubmissionListItemResponse {
  /** Submission id; ids sort by submission time. */
  id!: string;
  /** The submitter; null if the account no longer exists. */
  user!: UserSummaryResponse | null;
  /** The problem; null if it no longer exists. */
  problem!: SubmissionProblemResponse | null;
  /** The language; null if it was removed. */
  language!: SubmissionLanguageResponse | null;
  /** When the submission was made. */
  date!: Date;
  /** Judging state: `QU` queued, `P` processing, `G` grading, `D` done, `IE` internal error, `CE` compile error, `AB` aborted, `PD` pending final judging at contest end. */
  @ApiProperty({ enum: SUBMISSION_STATUSES, enumName: 'SubmissionStatus' })
  status!: SubmissionStatus;
  /** Verdict: `AC` accepted, `WA` wrong answer, `TLE` time limit, `MLE` memory limit, `OLE` output limit, `IR` invalid return, `RTE` runtime error, `CE` compile error, `IE` internal error, `SC` short circuited, `AB` aborted, `RJ` rejected; null while unjudged. */
  @ApiProperty({
    enum: SUBMISSION_RESULTS,
    enumName: 'SubmissionResult',
    nullable: true,
  })
  result!: SubmissionResult | null;
  /** Points awarded for the submission; null while unjudged. */
  points!: number | null;
  /** Points earned over all test cases. */
  casePoints!: number;
  /** Points available over all test cases. */
  caseTotal!: number;
  /** Seconds (largest case). */
  time!: number | null;
  /** KiB (largest case). */
  memory!: number | null;
  /** The first test results, only on the submission lists and only when the viewer could see them on the submission page (signed in; another user's contest submission only for the problem's editors and `judge.view_all_submission`); null otherwise. */
  testSummary!: SubmissionTestSummaryResponse | null;
  /** The contest it was submitted in, when the viewer may see that contest; null otherwise and outside a contest. */
  contest!: SubmissionContestResponse | null;

  static from(
    submission: Submission,
    { user, problem, language }: SubmissionRefs,
    {
      testSummary = null,
      contest = null,
    }: {
      testSummary?: TestSummary | null;
      contest?: SubmissionContestResponse | null;
    } = {},
  ): SubmissionListItemResponse {
    return {
      id: uuidStr(submission._id),
      user: user ? UserSummaryResponse.from(user) : null,
      problem: problem
        ? {
            code: problem.code,
            name: problem.name,
            points: problem.points,
            isDeleted: problem.deletedAt != null,
          }
        : null,
      language: language
        ? { id: language._id, key: language.key, name: language.name }
        : null,
      date: submission.date,
      status: submission.status,
      result: submission.result,
      points: submission.points,
      casePoints: submission.casePoints,
      caseTotal: submission.caseTotal,
      time: submission.time,
      memory: submission.memory,
      testSummary,
      contest,
    };
  }
}
