const MONGO_BSON_OBJECT_TOO_LARGE = 10334;

/** Whether `error` is Mongo (server or driver) refusing a document over the 16 MB limit. */
export function isDocumentTooLarge(error: unknown): boolean {
  const { code, message } = error as { code?: number; message?: unknown };
  return (
    code === MONGO_BSON_OBJECT_TOO_LARGE ||
    (typeof message === 'string' &&
      /larger than the maximum|BSONObj size|object to insert too large/i.test(
        message,
      ))
  );
}
