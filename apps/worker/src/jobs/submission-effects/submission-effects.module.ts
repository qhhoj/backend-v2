import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ORGANIZATION_POINTS_QUEUE } from '@libs/community';
import { CONTEST_RATING_QUEUE, CONTEST_REPLAY_QUEUE } from '@libs/contests';
import { JobsModule } from '@libs/common';
import { judgingJobs } from '@libs/judging';
import { QuotaLedgerModule } from '@libs/problems';
import { ContestResultsRepository } from './contest-results.repository';
import { SubmissionEffectsProcessor } from './submission-effects.processor';
import { SubmissionEffectsRepository } from './submission-effects.repository';
import { SubmissionEffectsService } from './submission-effects.service';

@Module({
  imports: [
    JobsModule.register(judgingJobs.graded),
    BullModule.registerQueue(
      { name: ORGANIZATION_POINTS_QUEUE },
      { name: CONTEST_REPLAY_QUEUE },
      { name: CONTEST_RATING_QUEUE },
    ),
    QuotaLedgerModule,
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
