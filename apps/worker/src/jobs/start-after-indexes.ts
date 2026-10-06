import type { Worker } from 'bullmq';
import type { Model } from 'mongoose';
import { Submission } from '@libs/database';

/** For a processor declared `autorun: false`: consumption starts only once the submissions indexes exist, since its reads hint to one and Mongo rejects a hint to a missing index. */
export async function startAfterIndexes(
  worker: Worker,
  submissions: Model<Submission>,
): Promise<void> {
  await submissions.init();
  if (!worker.isRunning()) void worker.run();
}
