import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { JobsModule, RateLimitService } from '@libs/common';
import { communityJobs } from '@libs/community';
import { ProblemsApiModule } from '../problems/problems-api.module';
import { ContributionPointsService } from './contribution-points.service';
import { VotesRepository } from './votes.repository';
import { VotesService } from './votes.service';

/** Votes on posts and comments and the contribution points they feed. */
@Module({
  imports: [
    AuthModule,
    forwardRef(() => ProblemsApiModule),
    JobsModule.register(communityJobs.contributionPoints),
  ],
  providers: [
    ContributionPointsService,
    VotesRepository,
    VotesService,
    RateLimitService,
  ],
  exports: [ContributionPointsService, VotesRepository, VotesService],
})
export class ContributionsModule {}
