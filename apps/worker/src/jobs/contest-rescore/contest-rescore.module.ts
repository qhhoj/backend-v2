import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import {
  CONTEST_RATING_QUEUE,
  CONTEST_REPLAY_QUEUE,
  CONTEST_RESCORE_QUEUE,
} from '@libs/contests';
import { SubmissionEffectsModule } from '../submission-effects/submission-effects.module';
import { ContestRescoreProcessor } from './contest-rescore.processor';
import { ContestRescoreRepository } from './contest-rescore.repository';
import { ContestRescoreService } from './contest-rescore.service';

@Module({
  imports: [
    SubmissionEffectsModule,
    BullModule.registerQueue(
      { name: CONTEST_RESCORE_QUEUE },
      { name: CONTEST_RATING_QUEUE },
      { name: CONTEST_REPLAY_QUEUE },
    ),
  ],
  providers: [
    ContestRescoreProcessor,
    ContestRescoreService,
    ContestRescoreRepository,
  ],
})
export class ContestRescoreModule {}
