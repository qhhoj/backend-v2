import type { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { JOB_RETENTION, JOB_RETRY, withinTimeout } from '@libs/judging';
import { CONTEST_ENQUEUE_TIMEOUT_MS } from './queues';

export const CONTEST_PUBLISH_QUEUE = 'contest-publish';
export const CONTEST_PUBLISH_JOB = 'publish';
export const CONTEST_PUBLISH_SWEEP_JOB = 'sweep';
export const CONTEST_PUBLISH_SCHEDULER = 'contest-publish-every-minute';
export const PUBLISH_SWEEP_MS = 60_000;

/** Publish the problems and editorials of a contest that switched `publishAfterEnd` on. */
export interface ContestPublishJob {
  contestId: string;
}

/** One delayed job per contest and end time (BullMQ ids cannot contain `:`). */
export const publishJobId = (contestId: string, endTime: Date): string =>
  `publish-${contestId}-${endTime.getTime()}`;

export interface PublishTarget {
  id: string;
  endTime: Date;
  publishAfterEnd: boolean;
}

/** After a create or an edit: the previous end's job goes, the new end's comes (delay 0 once past). Never throws: a failed removal is logged and the new job is still added (the old job finds a moved end or a cleared switch and does nothing), and the worker's minute sweep publishes any ended contest whose job was lost. */
export async function reschedulePublish(
  queue: Queue<ContestPublishJob>,
  change: { previous: PublishTarget | null; next: PublishTarget },
  logger: Logger,
  now = Date.now(),
): Promise<void> {
  const { previous, next } = change;
  const wasScheduled = previous !== null && previous.publishAfterEnd;
  const unchanged =
    wasScheduled &&
    next.publishAfterEnd &&
    previous.endTime.getTime() === next.endTime.getTime();
  if (unchanged) return;
  if (wasScheduled)
    await attempt(logger, `removal for contest ${previous.id}`, () =>
      queue.remove(publishJobId(previous.id, previous.endTime)),
    );
  if (next.publishAfterEnd)
    await attempt(logger, `scheduling for contest ${next.id}`, () =>
      queue.add(
        CONTEST_PUBLISH_JOB,
        { contestId: next.id },
        {
          jobId: publishJobId(next.id, next.endTime),
          delay: Math.max(0, next.endTime.getTime() - now),
          ...JOB_RETRY,
          ...JOB_RETENTION,
        },
      ),
    );
}

/** One queue call with its own timeout; a failure is logged, not thrown. */
async function attempt(
  logger: Logger,
  what: string,
  call: () => Promise<unknown>,
): Promise<void> {
  try {
    await withinTimeout(call(), CONTEST_ENQUEUE_TIMEOUT_MS);
  } catch (error) {
    logger.error(`Auto-publish ${what} failed: ${(error as Error).message}`);
  }
}
