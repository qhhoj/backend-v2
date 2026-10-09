import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ORGANIZATION_POINTS_QUEUE } from '@libs/community';
import { CONTEST_REPLAY_QUEUE } from '@libs/contests';
import { SUBMISSION_GRADED_QUEUE } from '@libs/judging';
import { ContestResultsRepository } from './contest-results.repository';
import { SubmissionEffectsProcessor } from './submission-effects.processor';
import { SubmissionEffectsRepository } from './submission-effects.repository';
import { SubmissionEffectsService } from './submission-effects.service';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: SUBMISSION_GRADED_QUEUE },
      { name: ORGANIZATION_POINTS_QUEUE },
      { name: CONTEST_REPLAY_QUEUE },
    ),
  ],
  providers: [
    SubmissionEffectsProcessor,
    SubmissionEffectsService,
    SubmissionEffectsRepository,
    ContestResultsRepository,
  ],
  exports: [
    SubmissionEffectsService,
    SubmissionEffectsRepository,
    ContestResultsRepository,
  ],
})
export class SubmissionEffectsModule {}
