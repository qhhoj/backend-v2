import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { PROBLEM_SOLVERS_QUEUE } from '@libs/problems';
import { SubmissionEffectsModule } from '../submission-effects/submission-effects.module';
import { ProblemSolversProcessor } from './problem-solvers.processor';
import { ProblemSolversRepository } from './problem-solvers.repository';
import { ProblemSolversService } from './problem-solvers.service';

@Module({
  imports: [
    SubmissionEffectsModule,
    BullModule.registerQueue({ name: PROBLEM_SOLVERS_QUEUE }),
  ],
  providers: [
    ProblemSolversProcessor,
    ProblemSolversService,
    ProblemSolversRepository,
  ],
})
export class ProblemSolversModule {}
