import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { CONTEST_EXPORT_QUEUE } from '@libs/contests';
import type { ContestExportJob } from '@libs/contests';
import { ContestExportService } from './contest-export.service';

/** One zip at a time per worker process: memory and disk. */
@Processor(CONTEST_EXPORT_QUEUE, { concurrency: 1 })
export class ContestExportProcessor extends WorkerHost {
  private readonly logger = new Logger(ContestExportProcessor.name);

  constructor(private readonly exports: ContestExportService) {
    super();
  }

  process(job: Job<ContestExportJob>): Promise<number> {
    return this.exports.prepare(job.data);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<ContestExportJob> | undefined, error: Error): void {
    this.logger.error(
      `Export of contest ${job?.data.contestId} failed: ${error.message}`,
    );
  }
}
