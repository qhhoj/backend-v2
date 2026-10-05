import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { POLYGON_QUEUE } from '@libs/problems';
import type { PolygonImportJob, PolygonImportResult } from '@libs/problems';
import { PolygonImportService } from './polygon-import.service';

@Processor(POLYGON_QUEUE, { concurrency: 1 })
export class PolygonImportProcessor extends WorkerHost {
  private readonly logger = new Logger(PolygonImportProcessor.name);

  constructor(private readonly imports: PolygonImportService) {
    super();
  }

  process(job: Job<PolygonImportJob>): Promise<PolygonImportResult> {
    return this.imports.import(job.data);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<PolygonImportJob> | undefined, error: Error): void {
    this.logger.error(
      `Polygon import of ${job?.data.code} failed: ${error.message}`,
    );
  }
}
