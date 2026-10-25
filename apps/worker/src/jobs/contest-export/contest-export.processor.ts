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
  CONTEST_EXPORT_QUEUE,
  CONTEST_ZIP_SWEEP_JOB,
  CONTEST_ZIP_SWEEP_MS,
  CONTEST_ZIP_SWEEP_SCHEDULER,
} from '@libs/contests';
import type { ContestExportJob } from '@libs/contests';
import { ContestExportService } from './contest-export.service';
import { ContestZipSweepService } from './contest-zip-sweep.service';

/** One zip at a time per worker process: memory and disk. The hourly sweep of the contest zips shares the queue. */
@Processor(CONTEST_EXPORT_QUEUE, { concurrency: 1 })
export class ContestExportProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(ContestExportProcessor.name);

  constructor(
    private readonly exports: ContestExportService,
    private readonly zips: ContestZipSweepService,
    @InjectQueue(CONTEST_EXPORT_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  /** One schedule for every worker process (the upsert is idempotent). */
  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      CONTEST_ZIP_SWEEP_SCHEDULER,
      { every: CONTEST_ZIP_SWEEP_MS },
      {
        name: CONTEST_ZIP_SWEEP_JOB,
        opts: { removeOnComplete: true, removeOnFail: 100 },
      },
    );
  }

  process(job: Job<ContestExportJob>): Promise<number> {
    return job.name === CONTEST_ZIP_SWEEP_JOB
      ? this.zips.sweep()
      : this.exports.prepare(job.data);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<ContestExportJob> | undefined, error: Error): void {
    this.logger.error(
      `${job?.name === CONTEST_ZIP_SWEEP_JOB ? 'Contest zip sweep' : `Export of contest ${job?.data.contestId}`} failed: ${error.message}`,
    );
  }
}
