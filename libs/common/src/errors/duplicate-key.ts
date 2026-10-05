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
