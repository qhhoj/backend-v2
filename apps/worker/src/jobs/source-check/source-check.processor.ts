import { Injectable } from '@nestjs/common';
import { JobProcessor } from '@libs/common';
import { problemJobs } from '@libs/problems';
import type { SourceCheckJob } from '@libs/problems';
import { SourceCheckService } from './source-check.service';

@Injectable()
export class SourceCheckProcessor extends JobProcessor<SourceCheckJob, void>(
  problemJobs.sourceCheck,
) {
  constructor(private readonly checks: SourceCheckService) {
    super();
  }

  run(job: SourceCheckJob): Promise<void> {
    return this.checks.check(job);
  }
}
