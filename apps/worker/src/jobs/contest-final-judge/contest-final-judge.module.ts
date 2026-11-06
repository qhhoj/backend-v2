import { Module } from '@nestjs/common';
import { JobsModule } from '@libs/common';
import { contestJobs } from '@libs/contests';
import { JudgingModule } from '@libs/judging';
import { ContestFinalJudgeProcessor } from './contest-final-judge.processor';
import { ContestFinalJudgeRepository } from './contest-final-judge.repository';
import { ContestFinalJudgeService } from './contest-final-judge.service';

@Module({
  imports: [JudgingModule, JobsModule.register(contestJobs.finalJudge)],
  providers: [
    ContestFinalJudgeProcessor,
    ContestFinalJudgeService,
    ContestFinalJudgeRepository,
  ],
})
export class ContestFinalJudgeModule {}
