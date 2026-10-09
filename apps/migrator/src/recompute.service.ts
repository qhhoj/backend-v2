import { Injectable } from '@nestjs/common';
import { Queue, QueueEvents } from 'bullmq';
import {
  MIGRATION_RECOMPUTE_JOB,
  MIGRATION_RECOMPUTE_JOB_ID,
  MIGRATION_RECOMPUTE_QUEUE,
} from '@libs/judging';
import type { MigrationRecomputeResult } from '@libs/judging';
import { requiredEnv } from './legacy-env';

/** A dead worker must not hang the command forever. */
const JOB_TIMEOUT_MS = 6 * 60 * 60 * 1000;

/** Queues the worker's migration recompute and waits for its result. Without a worker it fails at once instead of waiting forever. `getWorkers` uses Redis CLIENT LIST, which some managed Redis setups forbid (the runbook notes it). */
@Injectable()
export class RecomputeService {
  async run(
    redisUrl = requiredEnv('REDIS_URL'),
  ): Promise<MigrationRecomputeResult> {
    const connection = { url: redisUrl };
    const queue = new Queue(MIGRATION_RECOMPUTE_QUEUE, { connection });
    const events = new QueueEvents(MIGRATION_RECOMPUTE_QUEUE, { connection });
    try {
      await events.waitUntilReady();
      if ((await queue.getWorkers()).length === 0)
        throw new Error(
          `no worker on ${MIGRATION_RECOMPUTE_QUEUE}: start the worker against this Redis and Mongo, then run recompute again`,
        );
      const previous = await queue.getJob(MIGRATION_RECOMPUTE_JOB_ID);
      if (
        previous &&
        ((await previous.isCompleted()) || (await previous.isFailed()))
      )
        await previous.remove();
      const job = await queue.add(
        MIGRATION_RECOMPUTE_JOB,
        {},
        { jobId: MIGRATION_RECOMPUTE_JOB_ID },
      );
      return (await job.waitUntilFinished(
        events,
        JOB_TIMEOUT_MS,
      )) as MigrationRecomputeResult;
    } finally {
      await events.close();
      await queue.close();
    }
  }
}
