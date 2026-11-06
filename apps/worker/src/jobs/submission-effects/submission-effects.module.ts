import { Module } from '@nestjs/common';
import { communityJobs } from '@libs/community';
import { contestJobs } from '@libs/contests';
import { JobsModule } from '@libs/common';
import { judgingJobs } from '@libs/judging';
import { QuotaLedgerModule } from '@libs/problems';
import { ContestResultsRepository } from './contest-results.repository';
import { SubmissionEffectsProcessor } from './submission-effects.processor';
import { SubmissionEffectsRepository } from './submission-effects.repository';
import { SubmissionEffectsService } from './submission-effects.service';

@Module({
  imports: [
    JobsModule.register(
      judgingJobs.graded,
      communityJobs.organizationPoints,
      contestJobs.replay,
      contestJobs.rating,
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
