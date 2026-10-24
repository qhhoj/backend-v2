import type { Connection } from 'mongoose';
import { SCHEMAS } from './schemas';

/**
 * Builds every schema's indexes, one model at a time; the deploy runs it with the new image before the restart, so no
 * process serves a hinted read before its index exists. The first failure rejects: a unique index over duplicate
 * rows, or an index whose options changed (drop the old one by hand). Nothing is dropped: the version still serving
 * may hint an index the new one no longer declares.
 */
export async function buildIndexes(connection: Connection): Promise<void> {
  for (const { name, schema } of SCHEMAS) {
    const model = connection.model(name, schema);
    try {
      await model.createIndexes();
    } catch (error) {
      throw new Error(indexBuildFailure(model.collection.name, error));
    }
  }
}

/** What the deploy log may show of a failed build: the collection, the index and the error code. Never the server's message, which quotes the duplicated value (`dup key: { … }`) into a public log. */
export function indexBuildFailure(collection: string, error: unknown): string {
  const { code, codeName, message } = error as {
    code?: unknown;
    codeName?: unknown;
    message?: unknown;
  };
  const index =
    typeof message === 'string'
      ? (/\bindex: ([\w.$-]+)/.exec(message)?.[1] ?? 'unknown')
      : 'unknown';
  const reason = typeof codeName === 'string' ? codeName : 'error';
  return `index build failed on ${collection}, index ${index}: ${reason} (code ${typeof code === 'number' ? code : 'unknown'})`;
}
