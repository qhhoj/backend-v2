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
  PACKAGE_QUEUE,
  PACKAGE_SWEEP_JOB,
  PACKAGE_SWEEP_PATTERN,
  PACKAGE_SWEEP_SCHEDULER,
  PACKAGE_TOO_LARGE_REASON,
} from '@libs/problems';
import type { ProblemPackageJob } from '@libs/problems';
import { PackageTooLargeError } from './package-zip';
import { ProblemPackageService } from './problem-package.service';

/** One build at a time per worker process: disk and memory. */
@Processor(PACKAGE_QUEUE, { concurrency: 1 })
export class ProblemPackageProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(ProblemPackageProcessor.name);

  constructor(
    private readonly packages: ProblemPackageService,
    @InjectQueue(PACKAGE_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  /** One schedule for every worker process (the upsert is idempotent). */
  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      PACKAGE_SWEEP_SCHEDULER,
      { pattern: PACKAGE_SWEEP_PATTERN },
      {
        name: PACKAGE_SWEEP_JOB,
        opts: { removeOnComplete: true, removeOnFail: 100 },
      },
    );
  }

  /** An over-cap build fails with the reason the api maps to `409 package_too_large`; every other failure keeps its message in the log only. */
  async process(job: Job<ProblemPackageJob>): Promise<unknown> {
    if (job.name === PACKAGE_SWEEP_JOB) return this.packages.sweep();
    try {
      return await this.packages.build(job.data);
    } catch (error) {
      if (error instanceof PackageTooLargeError)
        throw new Error(PACKAGE_TOO_LARGE_REASON);
      throw error;
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<ProblemPackageJob> | undefined, error: Error): void {
    this.logger.error(
      `Package of ${job?.data.code ?? 'unknown'} failed: ${error.message}`,
    );
  }
}
