import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { SOURCE_CHECK_QUEUE } from '@libs/problems';
import type { SourceCheckJob } from '@libs/problems';
import { SourceCheckService } from './source-check.service';

/** Each check holds a judge slot for seconds; two at a time leaves the judges to submissions. */
@Processor(SOURCE_CHECK_QUEUE, { concurrency: 2 })
export class SourceCheckProcessor extends WorkerHost {
  private readonly logger = new Logger(SourceCheckProcessor.name);

  constructor(private readonly checks: SourceCheckService) {
    super();
  }

  process(job: Job<SourceCheckJob>): Promise<void> {
    return this.checks.check(job.data);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<SourceCheckJob>, error: Error): void {
    this.logger.error(
      `Compile check of ${job.data.kind} ${job.data.file} failed: ${error.message}`,
    );
  }
}
