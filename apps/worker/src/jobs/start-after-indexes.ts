import type { Worker } from 'bullmq';
import type { Model } from 'mongoose';
import { Submission } from '@libs/database';

/** For a processor declared `autorun: false`: consumption starts only once the submissions indexes exist, since its reads hint to one and Mongo rejects a hint to a missing index; `alsoWaitFor` adds models whose indexes its writes rely on (a unique index that makes a write idempotent). */
export async function startAfterIndexes(
  worker: Worker,
  submissions: Model<Submission>,
  alsoWaitFor: ReadonlyArray<{ init(): Promise<unknown> }> = [],
): Promise<void> {
  await Promise.all([
    submissions.init(),
    ...alsoWaitFor.map((model) => model.init()),
  ]);
  if (!worker.isRunning()) void worker.run();
}
