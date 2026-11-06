import { Injectable } from '@nestjs/common';
import { JobProcessor } from '@libs/common';
import { communityJobs } from '@libs/community';
import type { ContributionPointsJob } from '@libs/community';
import { ContributionPointsService } from './contribution-points.service';

@Injectable()
export class ContributionPointsProcessor extends JobProcessor<
  ContributionPointsJob,
  void
>(communityJobs.contributionPoints) {
  constructor(private readonly points: ContributionPointsService) {
    super();
  }

  run({ userId }: ContributionPointsJob): Promise<void> {
    return this.points.recompute(userId);
  }
}
