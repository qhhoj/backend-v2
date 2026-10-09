import type { Problem } from '@libs/database';
import type { WorkerTest } from './setup';

/** Puts a problem in its grace period without the delete route, so reader tests do not depend on it. */
export const softDeleteWorker = (
  worker: WorkerTest,
  problemId: string,
  extra: Partial<Problem> = {},
) =>
  worker.problems.updateOne(
    { _id: problemId },
    { $set: { deletedAt: new Date(Date.now() - 1000), ...extra } },
  );

/** What the purge leaves: code and name stay, the statement and every asset are gone. */
export const tombstoneWorker = (worker: WorkerTest, problemId: string) =>
  softDeleteWorker(worker, problemId, {
    purgeStartedAt: new Date(),
    purgedAt: new Date(),
    description: '',
    descriptionHtml: '',
    summary: '',
    translations: [],
    solution: null,
    pdfStatementUrl: null,
    materialUrl: null,
  });

/** Back to live, as the restore route leaves it. */
export const undeleteWorker = (worker: WorkerTest, problemId: string) =>
  worker.problems.updateOne(
    { _id: problemId },
    {
      $unset: {
        deletedAt: '',
        deletedBy: '',
        purgeStartedAt: '',
        purgedAt: '',
      },
    },
  );
