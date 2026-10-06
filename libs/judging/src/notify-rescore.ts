import type { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { enqueueRescore } from './queues';
import type { ProblemRescoreJob } from './queues';
import { withinTimeout } from './within-timeout';

/** Longest an edit or an import waits for its rescore job to reach Redis. */
export const RESCORE_ENQUEUE_TIMEOUT_MS = 1000;

/** Never rethrown: the edit or import is already committed; a lost rescore waits for the next edit or import of the problem (logged). */
export async function notifyRescore(
  queue: Queue<ProblemRescoreJob>,
  problemId: string,
  logger: Logger,
): Promise<void> {
  try {
    await withinTimeout(
      enqueueRescore(queue, problemId),
      RESCORE_ENQUEUE_TIMEOUT_MS,
    );
  } catch (error) {
    logger.error(
      `Rescore of problem ${problemId} not enqueued: ${(error as Error).message}`,
    );
  }
}
