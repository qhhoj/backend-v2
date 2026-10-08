import { AppError } from './app.error';
import type { FieldIssue } from './app.error';

const fieldsOf = (issues: FieldIssue[]): Record<string, string[]> =>
  issues.reduce<Record<string, string[]>>(
    (fields, { field, message }) => ({
      ...fields,
      [field]: [...(fields[field] ?? []), message],
    }),
    {},
  );

/** A 400 `validation_failed`: `fields` (messages, unchanged shape) and `issues` (codes) come from one list. */
export class ValidationFailedError extends AppError {
  constructor(message: string, issues: FieldIssue[]) {
    super('validation_failed', 400, message, fieldsOf(issues), undefined, {
      issues,
    });
  }
}
