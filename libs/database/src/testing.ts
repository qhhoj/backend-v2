import type { Db } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { SNAPSHOT_LOAD_COMMENT } from './snapshot-load';

export const startMongo = () =>
  MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });

export interface ProfiledOperation {
  collection: string;
  operation: string;
  /** `COLLSCAN` means no index was used. */
  planSummary: string;
  docsExamined: number;
  /** Index entries read; a regex that cannot bound its scan shows here, not in `docsExamined`. */
  keysExamined: number;
  /** True when the server sorted in memory (`planSummary` lists only index scans, never a SORT stage). */
  hasSortStage: boolean;
}

/**
 * Runs `work` with the database profiler on and returns every operation the server saw: index assertions observe what Mongo did, not the query text.
 * One allowance: a querier's snapshot load (`loadAll`, tagged `SNAPSHOT_LOAD_COMMENT`) is dropped. It scans a tiny registry on purpose and its
 * resync cron (settings every minute) can fire inside any window, so keeping it would fail index tests by wall-clock chance.
 */
export async function profileQueries(
  db: Db,
  work: () => Promise<unknown>,
): Promise<ProfiledOperation[]> {
  await db.command({ profile: 0 });
  await db
    .collection('system.profile')
    .drop()
    .catch(() => undefined);
  // The default 1 MB profile evicts the large entries of a bulk read.
  await db.createCollection('system.profile', {
    capped: true,
    size: 64 * 1024 * 1024,
  });
  await db.command({ profile: 2 });
  try {
    await work();
  } finally {
    await db.command({ profile: 0 });
  }
  const entries = await db.collection('system.profile').find({}).toArray();
  return entries
    .filter(
      (entry) =>
        (entry.command as { comment?: unknown } | undefined)?.comment !==
        SNAPSHOT_LOAD_COMMENT,
    )
    .map((entry) => ({
      collection: String(entry.ns).slice(db.databaseName.length + 1),
      operation: String(entry.op),
      planSummary: String(entry.planSummary ?? ''),
      docsExamined: Number(entry.docsExamined ?? 0),
      keysExamined: Number(entry.keysExamined ?? 0),
      hasSortStage: Boolean(entry.hasSortStage),
    }));
}
