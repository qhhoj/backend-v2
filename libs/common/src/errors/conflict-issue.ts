import { AppError } from './app.error';

/** A 409 `conflict` whose `issues: [{ field, code, message }]` carry a stable snake_case code next to the English message. */
export const conflictIssue = (field: string, code: string, message: string) =>
  new AppError('conflict', 409, message, undefined, undefined, {
    issues: [{ field, code, message }],
  });
