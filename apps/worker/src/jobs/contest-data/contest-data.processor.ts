import { Injectable } from '@nestjs/common';
import { JobProcessor } from '@libs/common';
import { contestJobs } from '@libs/contests';
import type { ContestDataJob } from '@libs/contests';
import { ContestDataService } from './contest-data.service';

@Injectable()
export class ContestDataProcessor extends JobProcessor<ContestDataJob, number>(
  contestJobs.data,
) {
  constructor(private readonly data: ContestDataService) {
    super();
  }

  run(job: ContestDataJob): Promise<number> {
    return this.data.prepare(job);
  }
}
