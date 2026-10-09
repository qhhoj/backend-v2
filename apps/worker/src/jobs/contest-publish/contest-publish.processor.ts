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
  CONTEST_PUBLISH_QUEUE,
  CONTEST_PUBLISH_SCHEDULER,
  CONTEST_PUBLISH_SWEEP_JOB,
  PUBLISH_SWEEP_MS,
} from '@libs/contests';
import type { ContestPublishJob } from '@libs/contests';
import { ContestPublishService } from './contest-publish.service';

@Processor(CONTEST_PUBLISH_QUEUE, { concurrency: 1 })
export class ContestPublishProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(ContestPublishProcessor.name);

  constructor(
    private readonly publishing: ContestPublishService,
    @InjectQueue(CONTEST_PUBLISH_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  /** One schedule for every worker process (the upsert is idempotent); overlapping sweeps are harmless, each contest's run is serialised. */
  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      CONTEST_PUBLISH_SCHEDULER,
      { every: PUBLISH_SWEEP_MS },
      {
        name: CONTEST_PUBLISH_SWEEP_JOB,
        opts: { removeOnComplete: true, removeOnFail: 100 },
      },
    );
  }

  process(job: Job<ContestPublishJob>): Promise<unknown> {
    return job.name === CONTEST_PUBLISH_SWEEP_JOB
      ? this.publishing.sweep()
      : this.publishing.run(job.data.contestId);
  }

  @OnWorkerEvent('error')
  onError(error: Error): void {
    this.logger.error(`Contest publish worker error: ${error.message}`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<ContestPublishJob> | undefined, error: Error): void {
    this.logger.error(
      `Contest publish ${job?.name} ${job?.data.contestId ?? ''} failed: ${error.message}`,
    );
  }
}
