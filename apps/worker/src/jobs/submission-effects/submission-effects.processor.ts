import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { SUBMISSION_GRADED_QUEUE } from '@libs/judging';
import type { SubmissionGradedJob } from '@libs/judging';
import { SubmissionEffectsService } from './submission-effects.service';

export const SUBMISSION_EFFECTS_CONCURRENCY = 4;

@Processor(SUBMISSION_GRADED_QUEUE, {
  concurrency: SUBMISSION_EFFECTS_CONCURRENCY,
})
export class SubmissionEffectsProcessor extends WorkerHost {
  private readonly logger = new Logger(SubmissionEffectsProcessor.name);

  constructor(private readonly effects: SubmissionEffectsService) {
    super();
  }

  process(job: Job<SubmissionGradedJob>): Promise<void> {
    return this.effects.apply(job.data);
  }

  /** Not retried: the sweep recomputes the user and the problem within its window. */
  @OnWorkerEvent('failed')
  onFailed(job: Job<SubmissionGradedJob> | undefined, error: Error): void {
    this.logger.error(
      `Effects of submission ${job?.data.submissionId} failed: ${error.message}`,
    );
  }
}
