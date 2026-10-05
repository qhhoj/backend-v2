const MONGO_DUPLICATE_KEY = 11000;

/** Whether `error` is a Mongo unique-index violation; with `field`, only one on that field. */
export function isDuplicateKey(error: unknown, field?: string): boolean {
  const { code, keyPattern } = error as {
    code?: number;
    keyPattern?: Record<string, unknown>;
  };
  return (
    code === MONGO_DUPLICATE_KEY &&
    (field === undefined || (keyPattern !== undefined && field in keyPattern))
  );
}

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
