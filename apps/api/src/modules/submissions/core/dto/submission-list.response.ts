import type { UserDocument } from '@libs/auth';
import { uuidStr } from '@libs/database';
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
}

export class SubmissionLanguageResponse {
  id!: string;
  key!: string;
  name!: string;
}

/** The rows resolved for one submission; a missing one renders as null. */
export interface SubmissionRefs {
  user: UserDocument | undefined;
  problem: Pick<Problem, 'code' | 'name'> | undefined;
  language: Language | null;
}

export class SubmissionListItemResponse {
  id!: string;
  user!: UserSummaryResponse | null;
  problem!: SubmissionProblemResponse | null;
  language!: SubmissionLanguageResponse | null;
  date!: Date;
  status!: SubmissionStatus;
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
      problem: problem ? { code: problem.code, name: problem.name } : null,
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
