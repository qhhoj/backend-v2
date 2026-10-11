import { AppError } from '@libs/common';
import { ExternalJudgeError } from '@libs/judging';
import type { ExternalJudgeErrorCode } from '@libs/judging';

/** The external judge is the upstream: its refusals are gateway errors, not the caller's. */
const STATUS: Record<ExternalJudgeErrorCode, number> = {
  external_judge_not_configured: 409,
  external_judge_unauthorized: 502,
  external_judge_not_found: 404,
  external_judge_rejected: 502,
  external_judge_unavailable: 503,
};

/** Runs an external judge call and answers its failure with the error code as the HTTP error code (the message is fixed: no base URL, no token). */
export async function askExternalJudge<Result>(
  call: () => Promise<Result>,
): Promise<Result> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof ExternalJudgeError)
      throw new AppError(error.code, STATUS[error.code], error.message);
    throw error;
  }
}
