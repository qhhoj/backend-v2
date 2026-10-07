import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { ORGANIZATION_POINTS_QUEUE } from '@libs/community';
import type { OrganizationPointsJob } from '@libs/community';
import { OrganizationPointsService } from './organization-points.service';

@Processor(ORGANIZATION_POINTS_QUEUE, { concurrency: 4 })
export class OrganizationPointsProcessor extends WorkerHost {
  private readonly logger = new Logger(OrganizationPointsProcessor.name);

  constructor(private readonly points: OrganizationPointsService) {
    super();
  }

  process(job: Job<OrganizationPointsJob>): Promise<void> {
    return this.points.recompute(job.data.organizationId);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<OrganizationPointsJob> | undefined, error: Error): void {
    this.logger.error(
      `Points of organization ${job?.data.organizationId} failed: ${error.message}`,
    );
  }
}
