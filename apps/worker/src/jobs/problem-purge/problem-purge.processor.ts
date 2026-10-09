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
  PROBLEM_PURGE_PATTERN,
  PROBLEM_PURGE_QUEUE,
  PROBLEM_PURGE_SCHEDULER,
  PROBLEM_PURGE_SWEEP_JOB,
} from '@libs/problems';
import type { ProblemPurgeJob } from '@libs/problems';
import { SettingsService } from '@libs/settings';
import { ProblemPurgeService } from './problem-purge.service';

/** One purge at a time: they delete directories and thousands of rows. */
@Processor(PROBLEM_PURGE_QUEUE, { concurrency: 1 })
export class ProblemPurgeProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(ProblemPurgeProcessor.name);

  constructor(
    private readonly purging: ProblemPurgeService,
    private readonly settings: SettingsService,
    @InjectQueue(PROBLEM_PURGE_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  /** One schedule for every worker process (the upsert is idempotent), at 03:30 in the site time zone read at boot. */
  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      PROBLEM_PURGE_SCHEDULER,
      {
        pattern: PROBLEM_PURGE_PATTERN,
        tz: this.settings.get('site.timeZone'),
      },
      {
        name: PROBLEM_PURGE_SWEEP_JOB,
        opts: { removeOnComplete: true, removeOnFail: 100 },
      },
    );
  }

  process(job: Job<ProblemPurgeJob>): Promise<unknown> {
    return job.name === PROBLEM_PURGE_SWEEP_JOB
      ? this.purging.sweep()
      : this.purging.purge(job.data.problemId);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<ProblemPurgeJob> | undefined, error: Error): void {
    this.logger.error(
      `Purge ${job?.name} ${job?.data.problemId ?? ''} failed: ${error.message}`,
    );
  }
}
