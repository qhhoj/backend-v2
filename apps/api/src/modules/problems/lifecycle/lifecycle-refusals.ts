import { AppError } from '@libs/common';

/** A refusal whose `error.issues[0].code` repeats the error code, so clients branch on one field. */
export function refusal(
  code: string,
  status: number,
  message: string,
): AppError {
  return new AppError(code, status, message, undefined, undefined, {
    issues: [{ field: 'problem', code, message }],
  });
}

/** Runs `action`; an `AppError` raised without issues (policy 403/404, rate limit 429) leaves with one, keeping status and headers. */
export async function withIssues<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (!(error instanceof AppError) || error.extra?.issues) throw error;
    throw new AppError(
      error.code,
      error.status,
      error.message,
      error.fields,
      error.headers,
      {
        ...error.extra,
        issues: [
          { field: 'problem', code: error.code, message: error.message },
        ],
      },
    );
  }
}
