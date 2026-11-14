/** Mongo's codes for a document over the 16 MB limit: the BSON size check, and an update whose result is too large (17419 on 7.0, 8375908 on 8.0). */
const MONGO_DOCUMENT_TOO_LARGE_CODES = new Set([10334, 17419, 8375908]);

/** Whether `error` is Mongo (server or driver) refusing a document over the 16 MB limit. */
export function isDocumentTooLarge(error: unknown): boolean {
  const { code, message } = error as { code?: number; message?: unknown };
  return (
    (code !== undefined && MONGO_DOCUMENT_TOO_LARGE_CODES.has(code)) ||
    (typeof message === 'string' &&
      /larger than the maximum|BSONObj size|object to insert too large|Resulting document after update is larger than/i.test(
        message,
      ))
  );
}
