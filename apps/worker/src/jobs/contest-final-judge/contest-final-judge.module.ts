import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CONTEST_FINAL_JUDGE_QUEUE } from '@libs/contests';
import { JudgingModule } from '@libs/judging';
import { ContestFinalJudgeProcessor } from './contest-final-judge.processor';
import { ContestFinalJudgeRepository } from './contest-final-judge.repository';
import { ContestFinalJudgeService } from './contest-final-judge.service';

@Module({
  imports: [
    JudgingModule,
    BullModule.registerQueue({ name: CONTEST_FINAL_JUDGE_QUEUE }),
  ],
  providers: [
    ContestFinalJudgeProcessor,
    ContestFinalJudgeService,
    ContestFinalJudgeRepository,
  ],
})
export class ContestFinalJudgeModule {}
