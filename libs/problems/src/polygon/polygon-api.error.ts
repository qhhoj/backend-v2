/** Why a Polygon call failed, as a stable code the api maps to an HTTP answer and the UI to a message. */
export const POLYGON_ERROR_CODES = [
  'polygon_not_connected',
  'polygon_unauthorized',
  'polygon_clock_skew',
  'polygon_unavailable',
  'polygon_failed',
  'polygon_package_unavailable',
  'polygon_package_too_large',
] as const;
export type PolygonErrorCode = (typeof POLYGON_ERROR_CODES)[number];

/** The message never contains the request: its body carries the api key and signature. */
export class PolygonApiError extends Error {
  constructor(
    readonly code: PolygonErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PolygonApiError';
  }
}

/** Polygon reports a refused request as a FAILED envelope with a free-text comment; the comment decides the code. */
export function failureOf(method: string, comment: unknown): PolygonApiError {
  const text = typeof comment === 'string' ? comment : 'unknown error';
  if (/\btime\b/i.test(text))
    return new PolygonApiError(
      'polygon_clock_skew',
      `Polygon refused the request time (${text}); check the server clock`,
    );
  if (/api ?key|signature|access|permission/i.test(text))
    return new PolygonApiError(
      'polygon_unauthorized',
      `Polygon refused the credentials (${text})`,
    );
  return new PolygonApiError('polygon_failed', `${method}: ${text}`);
}
