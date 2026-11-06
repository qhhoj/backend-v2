import { Injectable } from '@nestjs/common';
import { JobProcessor } from '@libs/common';
import { contestJobs } from '@libs/contests';
import type { ContestPublishJob } from '@libs/contests';
import { ContestPublishService } from './contest-publish.service';

@Injectable()
export class ContestPublishProcessor extends JobProcessor<ContestPublishJob>(
  contestJobs.publish,
  contestJobs.publishSweep,
) {
  constructor(private readonly publishing: ContestPublishService) {
    super();
  }

  run({ contestId }: ContestPublishJob): Promise<unknown> {
    return this.publishing.run(contestId);
  }

  sweep(): Promise<unknown> {
    return this.publishing.sweep();
  }
}
