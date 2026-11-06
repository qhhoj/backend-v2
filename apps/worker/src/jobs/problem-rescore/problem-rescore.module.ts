import { Module } from '@nestjs/common';
import { contestJobs } from '@libs/contests';
import { JobsModule } from '@libs/common';
import { judgingJobs } from '@libs/judging';
import { SubmissionEffectsModule } from '../submission-effects/submission-effects.module';
import { ProblemRescoreProcessor } from './problem-rescore.processor';
import { ProblemRescoreRepository } from './problem-rescore.repository';
import { ProblemRescoreService } from './problem-rescore.service';

@Module({
  imports: [
    SubmissionEffectsModule,
    JobsModule.register(judgingJobs.problemRescore, contestJobs.rescore),
  ],
  providers: [
    ProblemRescoreProcessor,
    ProblemRescoreService,
    ProblemRescoreRepository,
  ],
})
export class ProblemRescoreModule {}
