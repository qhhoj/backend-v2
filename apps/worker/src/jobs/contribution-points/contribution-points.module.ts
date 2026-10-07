import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CONTRIBUTION_POINTS_QUEUE } from '@libs/community';
import { ContributionPointsProcessor } from './contribution-points.processor';
import { ContributionPointsRepository } from './contribution-points.repository';
import { ContributionPointsService } from './contribution-points.service';

@Module({
  imports: [BullModule.registerQueue({ name: CONTRIBUTION_POINTS_QUEUE })],
  providers: [
    ContributionPointsProcessor,
    ContributionPointsService,
    ContributionPointsRepository,
  ],
})
export class ContributionPointsModule {}
