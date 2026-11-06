export const MONGO_DUPLICATE_KEY = 11000;

export interface WriteError {
  index: number;
  code?: number;
}

/** The failed writes of a bulk error (one object or an array in the driver), or none when it is another kind of error. */
export function writeErrorsOf(error: unknown): WriteError[] {
  const { writeErrors } = error as { writeErrors?: unknown };
  if (!writeErrors) return [];
  return (
    Array.isArray(writeErrors) ? writeErrors : [writeErrors]
  ) as WriteError[];
}

/** Whether `error` is a Mongo unique-index violation, in a single write or among a bulk write's failures; with `field`, only a single-write one on that field. */
export function isDuplicateKey(error: unknown, field?: string): boolean {
  const { code, keyPattern } = error as {
    code?: number;
    keyPattern?: Record<string, unknown>;
  };
  if (field === undefined)
    return (
      code === MONGO_DUPLICATE_KEY ||
      writeErrorsOf(error).some(
        (writeError) => writeError.code === MONGO_DUPLICATE_KEY,
      )
    );
  return (
    code === MONGO_DUPLICATE_KEY &&
    keyPattern !== undefined &&
    field in keyPattern
  );
}

/** Runs `write` up to `attempts` times while it loses a race on a unique index (`field` limits that to one index); the last duplicate-key error, or any other error, is thrown. */
export async function retryOnDuplicateKey<Result>(
  write: () => Promise<Result>,
  attempts: number,
  field?: string,
): Promise<Result> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await write();
    } catch (error) {
      if (!isDuplicateKey(error, field) || attempt >= attempts) throw error;
    }
  }
}
