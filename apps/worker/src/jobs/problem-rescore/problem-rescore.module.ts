import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { PROBLEM_RESCORE_QUEUE } from '@libs/judging';
import { SubmissionEffectsModule } from '../submission-effects/submission-effects.module';
import { ProblemRescoreProcessor } from './problem-rescore.processor';
import { ProblemRescoreRepository } from './problem-rescore.repository';
import { ProblemRescoreService } from './problem-rescore.service';

@Module({
  imports: [
    SubmissionEffectsModule,
    BullModule.registerQueue({ name: PROBLEM_RESCORE_QUEUE }),
  ],
  providers: [
    ProblemRescoreProcessor,
    ProblemRescoreService,
    ProblemRescoreRepository,
  ],
})
export class ProblemRescoreModule {}
