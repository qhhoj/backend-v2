import { issueError } from './issue-error';

/** A 409 `conflict` whose issue carries a stable snake_case code next to the English message. */
export const conflictIssue = (field: string, code: string, message: string) =>
  issueError('conflict', 409, { field, code, message });
