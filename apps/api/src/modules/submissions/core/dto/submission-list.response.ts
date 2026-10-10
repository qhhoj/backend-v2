import { ApiProperty } from '@nestjs/swagger';
import type { UserDocument } from '@libs/auth';
import {
  SUBMISSION_RESULTS,
  SUBMISSION_STATUSES,
  uuidStr,
} from '@libs/database';
import type {
  Language,
  Problem,
  Submission,
  SubmissionResult,
  SubmissionStatus,
} from '@libs/database';
import { UserSummaryResponse } from '../../../problems/core/dto/user-summary.response';

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

  static from(
    submission: Submission,
    { user, problem, language }: SubmissionRefs,
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
    };
  }
}
