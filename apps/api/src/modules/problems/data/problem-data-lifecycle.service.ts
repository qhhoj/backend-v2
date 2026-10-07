import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { STATEMENT_LANGUAGES } from '@libs/database';
import {
  PDF_QUEUE,
  PdfCacheService,
  pdfJobId,
  ProblemDataFilesService,
} from '@libs/problems';
import type { PdfRenderJob } from '@libs/problems';
import { ProblemEvents } from '../core/problem.events';
import { ProblemsRepository } from '../core/problems.repository';

@Injectable()
export class ProblemDataLifecycle implements OnModuleInit {
  private readonly logger = new Logger(ProblemDataLifecycle.name);

  constructor(
    private readonly repository: ProblemsRepository,
    private readonly dataFiles: ProblemDataFilesService,
    private readonly pdfCache: PdfCacheService,
    private readonly events: ProblemEvents,
    @InjectQueue(PDF_QUEUE) private readonly pdfQueue: Queue<PdfRenderJob>,
  ) {}

  /** Both volumes are keyed by code: the data directory follows the problem; cached PDFs are stale after a rename or any statement change. */
  onModuleInit(): void {
    this.events.on(
      'codeRenamed',
      (oldCode, newCode) => void this.moveData(oldCode, newCode),
    );
    this.events.on(
      'statementChanged',
      (problemId) => void this.dropPdfs(problemId),
    );
  }

  /** The new code's PDFs go too: a reused code must not serve another problem's statement. The orphan check in `edit` is not atomic with this move, so a lost race shows up only as the log line. */
  private async moveData(oldCode: string, newCode: string): Promise<void> {
    try {
      await this.dropPdfsOf(oldCode);
      await this.dropPdfsOf(newCode);
      await this.dataFiles.rename(oldCode, newCode);
    } catch (error) {
      this.logger.error(
        `Moving problem data ${oldCode} -> ${newCode} failed`,
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
