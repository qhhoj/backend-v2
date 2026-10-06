import type { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { enqueueGraded } from './queues';
import type { SubmissionGradedJob } from './queues';
import { withinTimeout } from './within-timeout';

/** Longest a request or packet waits for a graded job to reach Redis; the state is already in Mongo. */
export const GRADED_ENQUEUE_TIMEOUT_MS = 1000;

/** Never retried, rethrown or awaited past the bound: a late `add` is still delivered when Redis returns, and a retried `add` would queue a duplicate job (`enqueueGraded` has no `jobId`; duplicates are harmless recomputes, just wasted work). */
export async function notifyGraded(
  queue: Queue<SubmissionGradedJob>,
  job: SubmissionGradedJob | null,
  logger: Logger,
): Promise<void> {
  if (!job) return;
  try {
    await withinTimeout(enqueueGraded(queue, job), GRADED_ENQUEUE_TIMEOUT_MS);
  } catch (error) {
    logger.error(
      `Graded job of submission ${job.submissionId} not enqueued: ${(error as Error).message}`,
    );
  }
}
