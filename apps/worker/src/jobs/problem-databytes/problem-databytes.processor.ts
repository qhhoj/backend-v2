import {
  InjectQueue,
  OnWorkerEvent,
  Processor,
  WorkerHost,
} from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  PROBLEM_DATABYTES_JOB,
  PROBLEM_DATABYTES_JOB_ID,
  PROBLEM_DATABYTES_QUEUE,
} from '@libs/problems';
import { ProblemDataBytesService } from './problem-databytes.service';

@Processor(PROBLEM_DATABYTES_QUEUE, { concurrency: 1 })
export class ProblemDataBytesProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(ProblemDataBytesProcessor.name);

  constructor(
    private readonly sizes: ProblemDataBytesService,
    @InjectQueue(PROBLEM_DATABYTES_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  /** Every worker process adds the same job id; BullMQ keeps one. Completed and failed jobs are kept, which is what makes it one-off. */
  async onApplicationBootstrap(): Promise<void> {
    await this.queue.add(
      PROBLEM_DATABYTES_JOB,
      {},
      {
        jobId: PROBLEM_DATABYTES_JOB_ID,
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: false,
        removeOnFail: false,
      },
    );
  }

  process(): Promise<{ problems: number; bytes: number }> {
    return this.sizes.backfill();
  }

  @OnWorkerEvent('error')
  onError(error: Error): void {
    this.logger.error(`dataBytes backfill worker error: ${error.message}`);
  }

  @OnWorkerEvent('failed')
  onFailed(_job: unknown, error: Error): void {
    this.logger.error(`dataBytes backfill failed: ${error.message}`);
  }
}
