export class AppError extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
    message = code,
    readonly fields?: Record<string, string[]>,
  ) {
    super(message);
  }
}
