import { Injectable } from '@nestjs/common';
import type { FileHandle } from 'node:fs/promises';
import type { Principal } from '@libs/auth';
import {
  AppError,
  InjectJob,
  onDemandState,
  RateLimitService,
} from '@libs/common';
import type { JobProducer } from '@libs/common';
import type { StatementLanguage } from '@libs/database';
import { PdfCacheService, problemJobs, statementFor } from '@libs/problems';
import type { PdfRenderJob } from '@libs/problems';
import { ProblemsService } from '../core/problems.service';
import {
  PDF_RENDER_LIMIT,
  PDF_RENDER_WINDOW_SECONDS,
} from '../core/rate-limits';

/** `file` is open and owned by the caller; `filename` carries the language actually rendered. */
export type PdfLocation =
  | { status: 'ready'; file: FileHandle; filename: string }
  | { status: 'rendering' };

@Injectable()
export class ProblemPdfService {
  constructor(
    private readonly problems: ProblemsService,
    private readonly pdfCache: PdfCacheService,
    @InjectJob(problemJobs.pdf)
    private readonly renders: JobProducer<PdfRenderJob>,
    private readonly rateLimit: RateLimitService,
  ) {}

  /**
   * Cached file, or a render job (one per problem and language, `onDemandState`). A failed one answers 503 with Retry-After for its fail window instead of an endless 202. A statement change or rename removes it earlier (`ProblemDataLifecycleService`).
   * A pending or active job is answered for free; only a new enqueue spends the ip budget.
   * `shouldEnqueue: false` (HEAD) only peeks at the cache: no job, no rate-limit budget.
   */
  async locate(
    principal: Principal | null,
    pdf: { code: string; requestedLang: StatementLanguage; ip: string },
    { shouldEnqueue }: { shouldEnqueue: boolean },
  ): Promise<PdfLocation> {
    const { code, requestedLang, ip } = pdf;
    const problem = await this.problems.visibleProblem(principal, code);
    const { language } = statementFor(problem, requestedLang);
    const file = await this.pdfCache.open(problem.code, language);
    if (file)
      return {
        status: 'ready',
        file,
        filename: `${problem.code}.${language}.pdf`,
      };
    if (shouldEnqueue) await this.enqueueRender(ip, problem.code, language);
    return { status: 'rendering' };
  }

  private async enqueueRender(
    ip: string,
    code: string,
    lang: StatementLanguage,
  ): Promise<void> {
    const render = { code, lang };
    const state = await onDemandState(this.renders, render);
    if (state.status === 'building') return; // polling is free
    if (state.status === 'failed' && state.retryAfterSeconds > 0)
      throw new AppError(
        'pdf_unavailable',
        503,
        'The PDF could not be rendered; try again later',
        undefined,
        {
          'Retry-After': String(state.retryAfterSeconds),
          'Cache-Control': 'no-store',
        },
      );
    await this.rateLimit.reserve(
      [`pdf-render:ip:${ip}`],
      PDF_RENDER_LIMIT,
      PDF_RENDER_WINDOW_SECONDS,
    );
    await this.renders.addReplacingFailed(render);
  }
}
