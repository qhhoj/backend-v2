import { AppError } from '@libs/common';

/** An `AppError` whose `issues[0].code` is stable and snake_case; the SPA never matches the English message. */
export const exportRefusal = (
  status: number,
  code: string,
  issueCode: string,
  message: string,
): AppError =>
  new AppError(code, status, message, undefined, undefined, {
    issues: [{ field: 'export', code: issueCode, message }],
  });

/** Gives a refusal that has no `issues` (the viewer's 404/403) one coded after its error code. */
export const withIssueCode = (error: unknown): unknown => {
  if (!(error instanceof AppError) || error.extra?.issues) return error;
  return exportRefusal(error.status, error.code, error.code, error.message);
};
