import {
  InjectQueue,
  OnWorkerEvent,
  Processor,
  WorkerHost,
} from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import {
  USER_DATA_QUEUE,
  USER_DATA_SWEEP_JOB,
  USER_DATA_SWEEP_MS,
  USER_DATA_SWEEP_SCHEDULER,
} from '@libs/community';
import type { UserDataJob } from '@libs/community';
import { UserDataService } from './user-data.service';

/** One zip at a time per worker process (memory and disk); the hourly sweep shares the queue. */
@Processor(USER_DATA_QUEUE, { concurrency: 1 })
export class UserDataProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(UserDataProcessor.name);

  constructor(
    private readonly data: UserDataService,
    @InjectQueue(USER_DATA_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  /** One schedule for every worker process (the upsert is idempotent). */
  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      USER_DATA_SWEEP_SCHEDULER,
      { every: USER_DATA_SWEEP_MS },
      {
        name: USER_DATA_SWEEP_JOB,
        opts: { removeOnComplete: true, removeOnFail: 100 },
      },
    );
  }

  process(job: Job<UserDataJob>): Promise<number> {
    return job.name === USER_DATA_SWEEP_JOB
      ? this.data.sweep()
      : this.data.prepare(job.data.userId);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<UserDataJob> | undefined, error: Error): void {
    this.logger.error(
      `User data ${job?.name === USER_DATA_SWEEP_JOB ? 'sweep' : `of ${job?.data.userId}`} failed: ${error.message}`,
    );
  }
}
