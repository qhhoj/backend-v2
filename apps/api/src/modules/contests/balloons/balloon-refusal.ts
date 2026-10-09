import { AppError } from '@libs/common';

/** An `AppError` whose `issues[0].code` is stable and snake_case; the SPA never matches the English message. */
export const balloonRefusal = (
  status: number,
  code: string,
  issueCode: string,
  message: string,
): AppError =>
  new AppError(code, status, message, undefined, undefined, {
    issues: [{ field: 'balloons', code: issueCode, message }],
  });

/** Gives a refusal that has no `issues` (the viewer's 404, the limiter's 429) one coded after its error code. */
export const withIssueCode = (error: unknown): unknown => {
  if (!(error instanceof AppError) || error.extra?.issues) return error;
  return new AppError(
    error.code,
    error.status,
    error.message,
    undefined,
    error.headers,
    {
      issues: [{ field: 'balloons', code: error.code, message: error.message }],
    },
  );
};
