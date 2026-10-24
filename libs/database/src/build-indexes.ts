import type { Connection } from 'mongoose';
import { SCHEMAS } from './schemas';

/**
 * Builds every schema's indexes, one model at a time; the deploy runs it with the new image before the restart, so no
 * process serves a hinted read before its index exists. The first failure rejects: a unique index over duplicate
 * rows, or an index whose options changed (drop the old one by hand). Nothing is dropped: the version still serving
 * may hint an index the new one no longer declares.
 */
export async function buildIndexes(connection: Connection): Promise<void> {
  for (const { name, schema } of SCHEMAS)
    await connection.model(name, schema).createIndexes();
}
