import { AppError } from './app.error';
import type { FieldIssue } from './app.error';

/** A refusal whose one `issues: [{ field, code, message }]` entry carries a stable snake_case code next to the English message. */
export const issueError = (
  code: string,
  status: number,
  { field, code: issueCode, message }: FieldIssue,
) =>
  new AppError(code, status, message, undefined, undefined, {
    issues: [{ field, code: issueCode, message }],
  });
