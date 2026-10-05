import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import type { Job } from 'bullmq';
import { ENV } from '@libs/common';
import type { Env } from '@libs/common';
import { PDF_QUEUE } from '@libs/problems';
import type { PdfRenderJob } from '@libs/problems';
import { PdfRenderService } from './pdf-render.service';

@Processor(PDF_QUEUE)
export class PdfRenderProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(PdfRenderProcessor.name);

  constructor(
    private readonly render: PdfRenderService,
    @Inject(ENV) private readonly env: Env,
  ) {
    super();
  }

  /** The decorator's options are static, so the env-driven concurrency is applied once the worker exists. */
  onApplicationBootstrap(): void {
    this.worker.concurrency = this.env.pdfConcurrency;
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
