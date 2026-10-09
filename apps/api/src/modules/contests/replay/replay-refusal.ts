import { AppError } from '@libs/common';

/** Field every replay issue is reported on. */
export const REPLAY_ISSUE_FIELD = 'replay';

/** A refusal whose `issues[0].code` is stable and snake_case; the SPA never matches the English message. */
export const replayRefusal = (
  status: number,
  code: string,
  message: string,
  issueCode = code,
): AppError =>
  new AppError(code, status, message, undefined, undefined, {
    issues: [{ field: REPLAY_ISSUE_FIELD, code: issueCode, message }],
  });

/** Gives a refusal that has no `issues` (the viewer's 404 and 403, the rate limit's 429) one coded after its error code; headers such as `Retry-After` survive. */
export const withIssueCode = (error: unknown): unknown => {
  if (!(error instanceof AppError) || error.extra?.issues) return error;
  return new AppError(
    error.code,
    error.status,
    error.message,
    error.fields,
    error.headers,
    {
      ...error.extra,
      issues: [
        { field: REPLAY_ISSUE_FIELD, code: error.code, message: error.message },
      ],
    },
  );
};

/** Runs `work`; any `AppError` it throws leaves with an `issues[].code`. */
export async function withCodedRefusals<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw withIssueCode(error);
  }
}
