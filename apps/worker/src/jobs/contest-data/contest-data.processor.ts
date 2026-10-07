import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { CONTEST_DATA_QUEUE } from '@libs/contests';
import type { ContestDataJob } from '@libs/contests';
import { ContestDataService } from './contest-data.service';

/** One zip at a time per worker process: memory and disk. */
@Processor(CONTEST_DATA_QUEUE, { concurrency: 1 })
export class ContestDataProcessor extends WorkerHost {
  private readonly logger = new Logger(ContestDataProcessor.name);

  constructor(private readonly data: ContestDataService) {
    super();
  }

  process(job: Job<ContestDataJob>): Promise<number> {
    return this.data.prepare(job.data);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<ContestDataJob> | undefined, error: Error): void {
    this.logger.error(
      `Data of contest ${job?.data.contestId} failed: ${error.message}`,
    );
  }
}
