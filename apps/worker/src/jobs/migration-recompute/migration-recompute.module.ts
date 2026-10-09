import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { MIGRATION_RECOMPUTE_QUEUE } from '@libs/judging';
import { ContestRatingModule } from '../contest-rating/contest-rating.module';
import { ContributionPointsModule } from '../contribution-points/contribution-points.module';
import { OrganizationPointsModule } from '../organization-points/organization-points.module';
import { SubmissionEffectsModule } from '../submission-effects/submission-effects.module';
import { MigrationRecomputeProcessor } from './migration-recompute.processor';
import { MigrationRecomputeService } from './migration-recompute.service';
import { RatingReplayService } from './rating-replay.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: MIGRATION_RECOMPUTE_QUEUE }),
    SubmissionEffectsModule,
    OrganizationPointsModule,
    ContributionPointsModule,
    ContestRatingModule,
  ],
  providers: [
    MigrationRecomputeProcessor,
    MigrationRecomputeService,
    RatingReplayService,
  ],
})
export class MigrationRecomputeModule {}
