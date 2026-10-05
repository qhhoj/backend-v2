import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { POLYGON_ERROR_PREFIX, POLYGON_QUEUE } from '@libs/problems';
import type { PolygonImportJob, PolygonImportResult } from '@libs/problems';
import { PolygonImportError } from './polygon-import.error';
import { PolygonImportService } from './polygon-import.service';

@Processor(POLYGON_QUEUE, { concurrency: 1 })
export class PolygonImportProcessor extends WorkerHost {
  private readonly logger = new Logger(PolygonImportProcessor.name);

  constructor(private readonly imports: PolygonImportService) {
    super();
  }

  /** A `PolygonImportError` is shown to the requester, so it is stored with the prefix the api looks for. */
  async process(job: Job<PolygonImportJob>): Promise<PolygonImportResult> {
    try {
      return await this.imports.import(job.data);
    } catch (error) {
      throw error instanceof PolygonImportError
        ? new Error(POLYGON_ERROR_PREFIX + error.message)
        : error;
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<PolygonImportJob> | undefined, error: Error): void {
    this.logger.error(
      `Polygon import of ${job?.data.code} failed: ${error.message}`,
    );
  }
}
