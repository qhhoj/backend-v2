import { Injectable } from '@nestjs/common';
import { JobProcessor } from '@libs/common';
import { judgingJobs } from '@libs/judging';
import type { ProblemRescoreJob } from '@libs/judging';
import { ProblemRescoreService } from './problem-rescore.service';

/** Each run reads the problem's current points, so the run queued by the last edit settles it. */
@Injectable()
export class ProblemRescoreProcessor extends JobProcessor<
  ProblemRescoreJob,
  { rescored: number; users: number }
>(judgingJobs.problemRescore) {
  constructor(private readonly rescores: ProblemRescoreService) {
    super();
  }

  run({
    problemId,
  }: ProblemRescoreJob): Promise<{ rescored: number; users: number }> {
    return this.rescores.rescore(problemId);
  }
}
