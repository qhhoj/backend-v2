import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { FileHandle } from 'node:fs/promises';
import type { Principal } from '@libs/auth';
import { AppError, RateLimitService } from '@libs/common';
import type { StatementLanguage } from '@libs/database';
import {
  PDF_QUEUE,
  PdfCacheService,
  pdfJobId,
  statementFor,
} from '@libs/problems';
import type { PdfRenderJob } from '@libs/problems';
import { ProblemsService } from './problems.service';
import {
  PDF_FAIL_WINDOW_SECONDS,
  PDF_RENDER_LIMIT,
  PDF_RENDER_WINDOW_SECONDS,
} from './rate-limits';

/** `file` is open and owned by the caller; `filename` carries the language actually rendered. */
export type PdfLocation =
  | { status: 'ready'; file: FileHandle; filename: string }
  | { status: 'rendering' };

@Injectable()
export class ProblemPdfService {
  constructor(
    private readonly problems: ProblemsService,
    private readonly pdfCache: PdfCacheService,
    @InjectQueue(PDF_QUEUE) private readonly queue: Queue<PdfRenderJob>,
    private readonly rateLimit: RateLimitService,
  ) {}

  /**
   * Cached file, or a render job (one per problem and language). A completed job is removed so a later request can enqueue again; a failed one is kept for `PDF_FAIL_WINDOW_SECONDS`, answering 503 with Retry-After instead of an endless 202. A statement change or rename removes it earlier (`ProblemDataService`).
   * `enqueue: false` (HEAD) only peeks at the cache: no job, no rate-limit budget.
   */
  async locate(
    principal: Principal | null,
    ip: string,
    code: string,
    requestedLang: StatementLanguage,
    enqueue: boolean,
  ): Promise<PdfLocation> {
    const problem = await this.problems.visibleProblem(principal, code);
    const { language } = statementFor(problem, requestedLang);
    const file = await this.pdfCache.open(problem.code, language);
    if (file)
      return {
        status: 'ready',
        file,
        filename: `${problem.code}.${language}.pdf`,
      };
    if (enqueue) await this.enqueueRender(ip, problem.code, language);
    return { status: 'rendering' };
  }

  private async enqueueRender(
    ip: string,
    code: string,
    lang: StatementLanguage,
  ): Promise<void> {
    await this.rateLimit.reserve(
      [`pdf-render:ip:${ip}`],
      PDF_RENDER_LIMIT,
      PDF_RENDER_WINDOW_SECONDS,
    );
    const jobId = pdfJobId(code, lang);
    const previous = await this.queue.getJob(jobId);
    if (previous && (await previous.isFailed())) {
      const retryAfter = this.secondsUntilRetry(previous.finishedOn);
      if (retryAfter > 0)
        throw new AppError(
          'pdf_unavailable',
          503,
          'The PDF could not be rendered; try again later',
          undefined,
          { 'Retry-After': String(retryAfter) },
        );
      await previous.remove();
    }
    await this.queue.add(
      'render',
      { code, lang },
      {
        jobId,
        removeOnComplete: true,
        removeOnFail: { age: PDF_FAIL_WINDOW_SECONDS },
      },
    );
  }

  private secondsUntilRetry(finishedOn = 0): number {
    return Math.ceil(
      (finishedOn + PDF_FAIL_WINDOW_SECONDS * 1000 - Date.now()) / 1000,
    );
  }
}
