import { Injectable } from '@nestjs/common';
import { JobProcessor } from '@libs/common';
import { problemJobs } from '@libs/problems';
import type { ProblemPurgeJob } from '@libs/problems';
import { ProblemPurgeService } from './problem-purge.service';
import type { PurgeCounts } from './problem-purge.service';

@Injectable()
export class ProblemPurgeProcessor extends JobProcessor<
  ProblemPurgeJob,
  PurgeCounts | null
>(problemJobs.purge, problemJobs.purgeSweep) {
  constructor(private readonly purging: ProblemPurgeService) {
    super();
  }

  run(job: ProblemPurgeJob): Promise<PurgeCounts | null> {
    return this.purging.purge(job.problemId);
  }

  sweep(): Promise<number> {
    return this.purging.sweep();
  }
}
