import type { Db } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

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
}

/** Runs `work` with the database profiler on and returns every operation the server saw: index assertions observe what Mongo did, not the query text. */
export async function profileQueries(
  db: Db,
  work: () => Promise<unknown>,
): Promise<ProfiledOperation[]> {
  await db.command({ profile: 0 });
  await db
    .collection('system.profile')
    .drop()
    .catch(() => undefined);
  await db.command({ profile: 2 });
  try {
    await work();
  } finally {
    await db.command({ profile: 0 });
  }
  const entries = await db.collection('system.profile').find({}).toArray();
  return entries.map((entry) => ({
    collection: String(entry.ns).slice(db.databaseName.length + 1),
    operation: String(entry.op),
    planSummary: String(entry.planSummary ?? ''),
    docsExamined: Number(entry.docsExamined ?? 0),
  }));
}
