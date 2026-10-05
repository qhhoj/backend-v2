import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PDF_QUEUE } from '@libs/problems';
import type { PdfRenderJob } from '@libs/problems';
import { PdfRenderService } from './pdf-render.service';

@Processor(PDF_QUEUE, { concurrency: 2 })
export class PdfRenderProcessor extends WorkerHost {
  private readonly logger = new Logger(PdfRenderProcessor.name);

  constructor(private readonly render: PdfRenderService) {
    super();
  }

  process(job: Job<PdfRenderJob>): Promise<'rendered' | 'missing'> {
    return this.render.render(job.data);
  }

  /** Jobs are removed on failure (so a later request can enqueue again); the log is the only trace. */
  @OnWorkerEvent('failed')
  onFailed(job: Job<PdfRenderJob> | undefined, error: Error): void {
    this.logger.error(
      `PDF ${job?.data.code}.${job?.data.lang} failed: ${error.message}`,
    );
  }
}
