import { Module } from '@nestjs/common';
import { JobsModule } from '@libs/common';
import { contestJobs } from '@libs/contests';
import { SubmissionEffectsModule } from '../submission-effects/submission-effects.module';
import { ContestRescoreProcessor } from './contest-rescore.processor';
import { ContestRescoreRepository } from './contest-rescore.repository';
import { ContestRescoreService } from './contest-rescore.service';

@Module({
  imports: [
    SubmissionEffectsModule,
    JobsModule.register(
      contestJobs.rescore,
      contestJobs.rating,
      contestJobs.replay,
    ),
  ],
  providers: [
    ContestRescoreProcessor,
    ContestRescoreService,
    ContestRescoreRepository,
  ],
})
export class ContestRescoreModule {}
