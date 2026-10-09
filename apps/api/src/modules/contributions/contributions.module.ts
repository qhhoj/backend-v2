import { BullModule } from '@nestjs/bullmq';
import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { RateLimitService } from '@libs/common';
import { CONTRIBUTION_POINTS_QUEUE } from '@libs/community';
import { ProblemsApiModule } from '../problems/problems-api.module';
import { ContributionPointsService } from './contribution-points.service';
import { VotesRepository } from './votes.repository';
import { VotesService } from './votes.service';

/** Votes on posts and comments and the contribution points they feed. */
@Module({
  imports: [
    AuthModule,
    forwardRef(() => ProblemsApiModule),
    BullModule.registerQueue({ name: CONTRIBUTION_POINTS_QUEUE }),
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
