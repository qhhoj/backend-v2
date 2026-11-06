import { Injectable } from '@nestjs/common';
import { JobProcessor } from '@libs/common';
import { judgingJobs } from '@libs/judging';
import type { SubmissionGradedJob } from '@libs/judging';
import { SubmissionEffectsService } from './submission-effects.service';

/** Retried by the job's attempts; the sweep recomputes what still fails. */
@Injectable()
export class SubmissionEffectsProcessor extends JobProcessor<
  SubmissionGradedJob,
  void
>(judgingJobs.graded) {
  constructor(private readonly effects: SubmissionEffectsService) {
    super();
  }

  run(job: SubmissionGradedJob): Promise<void> {
    return this.effects.apply(job);
  }
}
