import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { POLYGON_ERROR_PREFIX, POLYGON_QUEUE } from '@libs/problems';
import type {
  ImportProgress,
  PolygonImportJob,
  PolygonImportResult,
} from '@libs/problems';
import type { PolygonSyncStep } from '@libs/database';
import { ImportTracker } from './import-tracker';
import { PolygonImportError } from './polygon-import.error';
import { PolygonImportRepository } from './polygon-import.repository';
import { PolygonImportService } from './polygon-import.service';
import { PolygonSyncRunsRepository } from './polygon-sync-runs.repository';

/** What a failure the requester may not see reads as; the api shows the same text. */
const GENERIC_FAILURE = 'Import failed';
/** The api shows at most this much of an import error; the history keeps the same. */
const MAX_RECORDED_ERROR = 1000;

@Processor(POLYGON_QUEUE, { concurrency: 1 })
export class PolygonImportProcessor extends WorkerHost {
  private readonly logger = new Logger(PolygonImportProcessor.name);

  constructor(
    private readonly imports: PolygonImportService,
    private readonly repository: PolygonImportRepository,
    private readonly runs: PolygonSyncRunsRepository,
  ) {
    super();
  }

  /** A `PolygonImportError` is shown to the requester, so it is stored with the prefix the api looks for. Every Polygon job is recorded in the sync history; a failure also stores its step on the job and, for a sync, on the problem's link. */
  async process(job: Job<PolygonImportJob>): Promise<PolygonImportResult> {
    const tracker = new ImportTracker((progress) => this.report(job, progress));
    const jobId = job.id ?? '';
    try {
      if (!jobId) throw new Error('A queued job always has an id');
      const result = await this.imports.import(jobId, job.data, tracker);
      await this.bestEffort('Sync run', () =>
        this.runs.record(jobId, job.data, {
          result: 'ok',
          problemId: result.problemId,
        }),
      );
      return result;
    } catch (error) {
      const shown = error instanceof PolygonImportError;
      await this.recordFailure(
        job,
        tracker.step,
        shown ? error.message.slice(0, MAX_RECORDED_ERROR) : GENERIC_FAILURE,
      );
      throw shown ? new Error(POLYGON_ERROR_PREFIX + error.message) : error;
    }
  }

  /** Recording never masks the import's own error. */
  private async recordFailure(
    job: Job<PolygonImportJob>,
    step: PolygonSyncStep,
    reason: string,
  ): Promise<void> {
    await this.bestEffort('Failed step', () =>
      job.updateData({ ...job.data, failedStep: step }),
    );
    await this.bestEffort('Sync failure', () =>
      this.repository.recordSyncFailure(job.data, reason),
    );
    await this.bestEffort('Sync run', () =>
      this.runs.record(job.id ?? '', job.data, {
        result: 'failed',
        step,
        error: reason,
      }),
    );
  }

  private async bestEffort(
    what: string,
    write: () => Promise<void>,
  ): Promise<void> {
    try {
      await write();
    } catch (error) {
      this.logger.warn(`${what} not recorded: ${(error as Error).message}`);
    }
  }

  /** Progress is for the status page only; losing an update never fails the import. */
  private async report(
    job: Job<PolygonImportJob>,
    progress: ImportProgress,
  ): Promise<void> {
    try {
      await job.updateProgress(progress);
    } catch (error) {
      this.logger.warn(
        `Import progress not saved: ${(error as Error).message}`,
      );
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<PolygonImportJob> | undefined, error: Error): void {
    this.logger.error(
      `Polygon import of ${job?.data.code} failed: ${error.message}`,
    );
  }
}
