import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { CONTRIBUTION_POINTS_QUEUE } from '@libs/community';
import type { ContributionPointsJob } from '@libs/community';
import { ContributionPointsService } from './contribution-points.service';

@Processor(CONTRIBUTION_POINTS_QUEUE, { concurrency: 4 })
export class ContributionPointsProcessor extends WorkerHost {
  private readonly logger = new Logger(ContributionPointsProcessor.name);

  constructor(private readonly points: ContributionPointsService) {
    super();
  }

  process(job: Job<ContributionPointsJob>): Promise<void> {
    return this.points.recompute(job.data.userId);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<ContributionPointsJob> | undefined, error: Error): void {
    this.logger.error(
      `Contribution points of user ${job?.data.userId} failed: ${error.message}`,
    );
  }
}
