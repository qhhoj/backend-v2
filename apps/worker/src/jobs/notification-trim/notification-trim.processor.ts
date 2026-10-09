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
  NOTIFICATION_TRIM_JOB,
  NOTIFICATION_TRIM_PATTERN,
  NOTIFICATION_TRIM_QUEUE,
  NOTIFICATION_TRIM_SCHEDULER,
} from '@libs/community';
import { JOB_RETRY } from '@libs/judging';
import { NotificationTrimService } from './notification-trim.service';

@Processor(NOTIFICATION_TRIM_QUEUE, { concurrency: 1 })
export class NotificationTrimProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(NotificationTrimProcessor.name);

  constructor(
    private readonly trims: NotificationTrimService,
    @InjectQueue(NOTIFICATION_TRIM_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  /** One schedule for every worker process (the upsert is idempotent). A pattern schedule queues no job at boot. */
  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      NOTIFICATION_TRIM_SCHEDULER,
      { pattern: NOTIFICATION_TRIM_PATTERN },
      {
        name: NOTIFICATION_TRIM_JOB,
        opts: { ...JOB_RETRY, removeOnComplete: true, removeOnFail: 100 },
      },
    );
  }

  process(): Promise<{ users: number; deleted: number }> {
    return this.trims.trim();
  }

  @OnWorkerEvent('failed')
  onFailed(_job: Job | undefined, error: Error): void {
    this.logger.error(`Inbox trim failed: ${error.message}`);
  }
}
