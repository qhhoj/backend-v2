import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { STATEMENT_LANGUAGES } from '@libs/database';
import {
  PackageCacheService,
  PDF_QUEUE,
  PdfCacheService,
  pdfJobId,
} from '@libs/problems';
import type { PdfRenderJob } from '@libs/problems';
import { ProblemEvents } from '../core/problem.events';
import { ProblemsRepository } from '../core/problems.repository';

@Injectable()
export class ProblemDataLifecycleService implements OnModuleInit {
  private readonly logger = new Logger(ProblemDataLifecycleService.name);

  constructor(
    private readonly repository: ProblemsRepository,
    private readonly pdfCache: PdfCacheService,
    private readonly packages: PackageCacheService,
    private readonly events: ProblemEvents,
    @InjectQueue(PDF_QUEUE) private readonly pdfQueue: Queue<PdfRenderJob>,
  ) {}

  /** Both caches are keyed by code: cached PDFs and packages are stale after a rename, PDFs after any statement change too. The data directory itself moves inside the rename's save (`ProblemEditingService`), under the data locks. */
  onModuleInit(): void {
    this.events.on(
      'codeRenamed',
      (oldCode, newCode) => void this.dropRenamedCaches(oldCode, newCode),
    );
    this.events.on(
      'statementChanged',
      (problemId) => void this.dropPdfs(problemId),
    );
  }

  /** The new code's files go too: a reused code must not serve another problem's statement or package. */
  private async dropRenamedCaches(
    oldCode: string,
    newCode: string,
  ): Promise<void> {
    try {
      await this.dropPdfsOf(oldCode);
      await this.dropPdfsOf(newCode);
      await this.packages.deleteAll(oldCode);
      await this.packages.deleteAll(newCode);
    } catch (error) {
      this.logger.error(
        `Dropping cached files of ${oldCode} -> ${newCode} failed`,
        error,
      );
    }
  }

  private async dropPdfs(problemId: string): Promise<void> {
    try {
      const problem = await this.repository.findById(problemId);
      if (problem) await this.dropPdfsOf(problem.code);
    } catch (error) {
      this.logger.error(`Dropping cached PDFs of ${problemId} failed`, error);
    }
  }

  /** Cached files and render jobs (a failed one would keep answering 503 for a statement that has changed since); an active job cannot be removed, the worker's stale check covers it. */
  private async dropPdfsOf(code: string): Promise<void> {
    await this.pdfCache.delete(code);
    await Promise.all(
      STATEMENT_LANGUAGES.map((lang) =>
        this.pdfQueue.remove(pdfJobId(code, lang)),
      ),
    );
  }
}
