import { AppError } from './app.error';
import type { FieldIssue } from './app.error';

/** Error code to the issue code clients branch on, where they differ. */
const ISSUE_CODES: Record<string, string> = { unauthorized: 'unauthenticated' };

/** The `issues[]` of a refusal raised without any (guards, limiter, policy): one request-level issue named after its code, so every 4xx carries the contract's shape. */
const defaultIssues = (code: string, message: string): FieldIssue[] => [
  { field: '', code: ISSUE_CODES[code] ?? code, message },
];

/** The one builder of the wire error `{ error: { code, message, issues?, fields?, ...extra } }`; a 5xx carries no issues. */
export function errorEnvelope(error: AppError) {
  return {
    error: {
      ...(error.status < 500 && {
        issues: defaultIssues(error.code, error.message),
      }),
      ...error.extra,
      code: error.code,
      message: error.message,
      ...(error.fields && { fields: error.fields }),
    },
  };
}
