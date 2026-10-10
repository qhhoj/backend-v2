import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { POLYGON_ERROR_PREFIX, POLYGON_QUEUE } from '@libs/problems';
import type {
  ImportProgress,
  PolygonImportJob,
  PolygonImportResult,
} from '@libs/problems';
import { PolygonImportError } from './polygon-import.error';
import { PolygonImportRepository } from './polygon-import.repository';
import { PolygonImportService } from './polygon-import.service';

@Processor(POLYGON_QUEUE, { concurrency: 1 })
export class PolygonImportProcessor extends WorkerHost {
  private readonly logger = new Logger(PolygonImportProcessor.name);

  constructor(
    private readonly imports: PolygonImportService,
    private readonly repository: PolygonImportRepository,
  ) {
    super();
  }

  /** A `PolygonImportError` is shown to the requester, so it is stored with the prefix the api looks for. A failed Polygon sync is also recorded on the problem's link. */
  async process(job: Job<PolygonImportJob>): Promise<PolygonImportResult> {
    try {
      if (!job.id) throw new Error('A queued job always has an id');
      return await this.imports.import(job.id, job.data, (progress) =>
        this.report(job, progress),
      );
    } catch (error) {
      const shown = error instanceof PolygonImportError;
      await this.repository
        .recordSyncFailure(job.data, shown ? error.message : 'Import failed')
        .catch((recordError: Error) =>
          this.logger.warn(`Sync failure not recorded: ${recordError.message}`),
        );
      throw shown ? new Error(POLYGON_ERROR_PREFIX + error.message) : error;
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
