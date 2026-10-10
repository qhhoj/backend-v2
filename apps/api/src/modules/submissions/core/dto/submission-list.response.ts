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
  code!: string;
  name!: string;
  /** The problem's max points: the denominator of a submission's score. */
  points!: number;
  /** The problem was deleted or purged; its name is kept. */
  isDeleted!: boolean;
}

export class SubmissionLanguageResponse {
  id!: string;
  key!: string;
  name!: string;
}

/** The rows resolved for one submission; a missing one renders as null. */
export interface SubmissionRefs {
  user: UserDocument | undefined;
  problem: Pick<Problem, 'code' | 'name' | 'points' | 'deletedAt'> | undefined;
  language: Language | null;
}

export class SubmissionListItemResponse {
  id!: string;
  user!: UserSummaryResponse | null;
  problem!: SubmissionProblemResponse | null;
  language!: SubmissionLanguageResponse | null;
  date!: Date;
  @ApiProperty({ enum: SUBMISSION_STATUSES, enumName: 'SubmissionStatus' })
  status!: SubmissionStatus;
  @ApiProperty({
    enum: SUBMISSION_RESULTS,
    enumName: 'SubmissionResult',
    nullable: true,
  })
  result!: SubmissionResult | null;
  points!: number | null;
  casePoints!: number;
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
