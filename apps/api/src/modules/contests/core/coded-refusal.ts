import { AppError } from '@libs/common';

/** Builds the refusals of one feature: an `AppError` whose `issues[0].code` is stable and snake_case, so the SPA never matches the English message. Refusals raised without issues (guards, viewers, limiter) get a request-level one from the exception filter. */
export const refusalsOf =
  (field: string) =>
  (
    status: number,
    code: string,
    issueCode: string,
    message: string,
  ): AppError =>
    new AppError(code, status, message, undefined, undefined, {
      issues: [{ field, code: issueCode, message }],
    });
