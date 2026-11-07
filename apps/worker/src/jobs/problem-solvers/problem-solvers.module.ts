import { Module } from '@nestjs/common';
import { JobsModule } from '@libs/common';
import { problemJobs } from '@libs/problems';
import { SubmissionEffectsModule } from '../submission-effects/submission-effects.module';
import { ProblemSolversProcessor } from './problem-solvers.processor';
import { ProblemSolversRepository } from './problem-solvers.repository';
import { ProblemSolversService } from './problem-solvers.service';

@Module({
  imports: [SubmissionEffectsModule, JobsModule.register(problemJobs.solvers)],
  providers: [
    ProblemSolversProcessor,
    ProblemSolversService,
    ProblemSolversRepository,
  ],
})
export class ProblemSolversModule {}
