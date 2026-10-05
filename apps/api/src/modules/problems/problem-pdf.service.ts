import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { Principal } from '@libs/auth';
import { AppError, RateLimitService } from '@libs/common';
import type { StatementLanguage } from '@libs/database';
import { PDF_QUEUE, PdfCacheService, pdfJobId } from '@libs/problems';
import type { PdfRenderJob } from '@libs/problems';
import { ProblemsService } from './problems.service';
import {
  PDF_JOB_RETRY_LIMIT,
  PDF_JOB_RETRY_WINDOW_SECONDS,
  PDF_RENDER_LIMIT,
  PDF_RENDER_WINDOW_SECONDS,
} from './rate-limits';

export type PdfLocation =
  { status: 'ready'; path: string } | { status: 'rendering' };

@Injectable()
export class ProblemPdfService {
  constructor(
    private readonly problems: ProblemsService,
    private readonly pdfCache: PdfCacheService,
    @InjectQueue(PDF_QUEUE) private readonly queue: Queue<PdfRenderJob>,
    private readonly rateLimit: RateLimitService,
  ) {}

  /** Cached file, or a render job (one per problem and language; completed and failed jobs are removed so a later request can enqueue again, and a render that keeps failing ends in 503 instead of an endless 202). */
  async locate(
    principal: Principal | null,
    ip: string,
    code: string,
    lang: StatementLanguage,
  ): Promise<PdfLocation> {
    const problem = await this.problems.visibleProblem(principal, code);
    if (await this.pdfCache.exists(problem.code, lang))
      return {
        status: 'ready',
        path: this.pdfCache.pathOf(problem.code, lang),
      };
    await this.rateLimit.reserve(
      [`pdf-render:ip:${ip}`],
      PDF_RENDER_LIMIT,
      PDF_RENDER_WINDOW_SECONDS,
    );
    const jobId = pdfJobId(problem.code, lang);
    if (!(await this.queue.getJob(jobId)))
      await this.assertRenderCanRetry(jobId);
    await this.queue.add(
      'render',
      { code: problem.code, lang },
      { jobId, removeOnComplete: true, removeOnFail: true },
    );
    return { status: 'rendering' };
  }

  /** Counts fresh jobs only: polling clients share the one pending job and never reach this. */
  private async assertRenderCanRetry(jobId: string): Promise<void> {
    const freshJobs = await this.rateLimit.hit(
      `pdf-job:${jobId}`,
      PDF_JOB_RETRY_WINDOW_SECONDS,
    );
    if (freshJobs > PDF_JOB_RETRY_LIMIT)
      throw new AppError(
        'pdf_unavailable',
        503,
        'The PDF could not be rendered; try again later',
      );
  }
}
