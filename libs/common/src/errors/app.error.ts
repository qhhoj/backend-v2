/** One failing field with a machine code (snake_case) next to the English message. */
export interface FieldIssue {
  field: string;
  code: string;
  message: string;
  /** 1-based row of a CSV import (the header is row 1); absent when the issue belongs to no row. */
  row?: number;
}

const issuesOf = (fields: Record<string, string[]>): FieldIssue[] =>
  Object.entries(fields).flatMap(([field, messages]) =>
    messages.map((message) => ({ field, code: 'invalid', message })),
  );

export class AppError extends Error {
  /** Members merged into the wire error object next to `code` and `message` (never overriding them). */
  readonly extra?: Record<string, unknown>;

  constructor(
    readonly code: string,
    readonly status = 400,
    message = code,
    readonly fields?: Record<string, string[]>,
    readonly headers?: Record<string, string>,
    extra?: Record<string, unknown>,
  ) {
    super(message);
    this.extra =
      fields && !extra?.issues ? { ...extra, issues: issuesOf(fields) } : extra;
  }
}
