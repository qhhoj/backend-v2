import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CONTRIBUTION_POINTS_QUEUE } from '@libs/community';
import { CONTEST_PUBLISH_QUEUE } from '@libs/contests';
import { PROBLEM_RESCORE_QUEUE } from '@libs/judging';
import { ContestPublishProcessor } from './contest-publish.processor';
import { ContestPublishRepository } from './contest-publish.repository';
import { ContestPublishService } from './contest-publish.service';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: CONTEST_PUBLISH_QUEUE },
      { name: PROBLEM_RESCORE_QUEUE },
      { name: CONTRIBUTION_POINTS_QUEUE },
    ),
  ],
  providers: [
    ContestPublishProcessor,
    ContestPublishService,
    ContestPublishRepository,
  ],
})
export class ContestPublishModule {}
