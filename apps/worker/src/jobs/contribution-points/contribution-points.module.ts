import { Module } from '@nestjs/common';
import { JobsModule } from '@libs/common';
import { communityJobs } from '@libs/community';
import { ContributionPointsProcessor } from './contribution-points.processor';
import { ContributionPointsRepository } from './contribution-points.repository';
import { ContributionPointsService } from './contribution-points.service';

@Module({
  imports: [JobsModule.register(communityJobs.contributionPoints)],
  providers: [
    ContributionPointsProcessor,
    ContributionPointsService,
    ContributionPointsRepository,
  ],
  exports: [ContributionPointsService],
})
export class ContributionPointsModule {}
