import { Inject, Injectable } from '@nestjs/common';
import { ENV, JobProcessor } from '@libs/common';
import type { Env } from '@libs/common';
import { problemJobs } from '@libs/problems';
import type { PdfRenderJob } from '@libs/problems';
import { PdfRenderService } from './pdf-render.service';

type RenderOutcome = 'rendered' | 'missing' | 'stale';

/** A failed job stays for its fail window (the api answers 503 meanwhile); the log is the only trace of why. */
@Injectable()
export class PdfRenderProcessor extends JobProcessor<
  PdfRenderJob,
  RenderOutcome
>(problemJobs.pdf) {
  constructor(
    private readonly render: PdfRenderService,
    @Inject(ENV) private readonly env: Env,
  ) {
    super();
  }

  /** The decorator's options are static, so the env-driven concurrency is applied before the worker starts. */
  override onApplicationBootstrap(): Promise<void> {
    this.worker.concurrency = this.env.pdfConcurrency;
    return super.onApplicationBootstrap();
  }

  run(job: PdfRenderJob): Promise<RenderOutcome> {
    return this.render.render(job);
  }
}
