import type { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { enqueueGraded } from './queues';
import type { SubmissionGradedJob } from './queues';
import { withinTimeout } from './within-timeout';

/** Longest a request or packet waits for a graded job to reach Redis; the state is already in Mongo. */
export const GRADED_ENQUEUE_TIMEOUT_MS = 1000;

/** Never retried, rethrown or awaited past the bound: a late `add` is still delivered when Redis returns. Without a `jobId` a retried `add` would queue a duplicate job (a harmless recompute, just wasted work); with one (the bridge's `gradedJobId`) BullMQ drops the duplicate while the first waits. */
export async function notifyGraded(
  queue: Queue<SubmissionGradedJob>,
  job: SubmissionGradedJob | null,
  logger: Logger,
  jobId?: string,
): Promise<void> {
  if (!job) return;
  try {
    await withinTimeout(
      enqueueGraded(queue, job, jobId),
      GRADED_ENQUEUE_TIMEOUT_MS,
    );
  } catch (error) {
    logger.error(
      `Graded job of submission ${job.submissionId} not enqueued: ${(error as Error).message}`,
    );
  }
}
