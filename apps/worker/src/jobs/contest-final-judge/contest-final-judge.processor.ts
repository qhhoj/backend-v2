import { Injectable } from '@nestjs/common';
import { JobProcessor } from '@libs/common';
import { contestJobs } from '@libs/contests';
import type { ContestFinalJudgeJob } from '@libs/contests';
import { ContestFinalJudgeService } from './contest-final-judge.service';

@Injectable()
export class ContestFinalJudgeProcessor extends JobProcessor<
  ContestFinalJudgeJob,
  number
>(contestJobs.finalJudge, contestJobs.finalJudgeSweep) {
  constructor(private readonly finalJudging: ContestFinalJudgeService) {
    super();
  }

  run({ contestId, manual }: ContestFinalJudgeJob): Promise<number> {
    return this.finalJudging.judgeFinal(contestId, { isManual: manual });
  }

  sweep(): Promise<number> {
    return this.finalJudging.sweep();
  }
}
