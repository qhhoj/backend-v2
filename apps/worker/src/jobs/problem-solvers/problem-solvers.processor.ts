import { Injectable } from '@nestjs/common';
import { JobProcessor } from '@libs/common';
import { problemJobs } from '@libs/problems';
import type { ProblemSolversJob } from '@libs/problems';
import { ProblemSolversService } from './problem-solvers.service';

@Injectable()
export class ProblemSolversProcessor extends JobProcessor<
  ProblemSolversJob,
  number
>(problemJobs.solvers) {
  constructor(private readonly solvers: ProblemSolversService) {
    super();
  }

  run(job: ProblemSolversJob): Promise<number> {
    return this.solvers.recompute(job.problemId);
  }
}
