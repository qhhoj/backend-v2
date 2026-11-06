import { Injectable } from '@nestjs/common';
import { JobProcessor } from '@libs/common';
import { contestJobs } from '@libs/contests';
import type { ContestRescoreJob } from '@libs/contests';
import { ContestRescoreService } from './contest-rescore.service';

@Injectable()
export class ContestRescoreProcessor extends JobProcessor<
  ContestRescoreJob,
  { rescored: number; participations: number }
>(contestJobs.rescore) {
  constructor(private readonly rescores: ContestRescoreService) {
    super();
  }

  run({ contestId, problemId, participationId }: ContestRescoreJob) {
    return this.rescores.rescore(contestId, { problemId, participationId });
  }
}
