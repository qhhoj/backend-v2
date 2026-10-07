import type { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { JOB_RETENTION, withinTimeout } from '@libs/judging';

export const CONTEST_RESCORE_QUEUE = 'contest-rescore';
export const CONTEST_RESCORE_JOB = 'rescore';
/** Recompute every contest submission's points and every participation of the contest. Enqueued by contest edits that change scoring (format, config, freeze, precision, problems), disqualifications and problem rescores. */
export interface ContestRescoreJob {
  contestId: string;
}
/** Longest an edit waits for its job to reach Redis. */
export const CONTEST_ENQUEUE_TIMEOUT_MS = 1000;

/** No `jobId`, like `enqueueRescore`: an edit during a running rescore must queue another; the queue runs one at a time, oldest first, so the last edit wins. */
export const enqueueContestRescore = async (
  queue: Queue<ContestRescoreJob>,
  contestId: string,
): Promise<void> => {
  await queue.add(
    CONTEST_RESCORE_JOB,
    { contestId },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 10_000 },
      ...JOB_RETENTION,
    },
  );
};

/** Never rethrown: the edit is committed; a lost rescore waits for the next scoring edit (logged). */
export async function notifyContestRescore(
  queue: Queue<ContestRescoreJob>,
  contestId: string,
  logger: Logger,
): Promise<void> {
  try {
    await withinTimeout(
      enqueueContestRescore(queue, contestId),
      CONTEST_ENQUEUE_TIMEOUT_MS,
    );
  } catch (error) {
    logger.error(
      `Rescore of contest ${contestId} not enqueued: ${(error as Error).message}`,
    );
  }
}
