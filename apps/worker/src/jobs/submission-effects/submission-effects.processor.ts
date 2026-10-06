import { InjectModel } from '@nestjs/mongoose';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { Model } from 'mongoose';
import { Submission } from '@libs/database';
import { SUBMISSION_GRADED_QUEUE } from '@libs/judging';
import type { SubmissionGradedJob } from '@libs/judging';
import { startAfterIndexes } from '../start-after-indexes';
import { SubmissionEffectsService } from './submission-effects.service';

export const SUBMISSION_EFFECTS_CONCURRENCY = 4;

@Processor(SUBMISSION_GRADED_QUEUE, {
  concurrency: SUBMISSION_EFFECTS_CONCURRENCY,
  autorun: false,
})
export class SubmissionEffectsProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(SubmissionEffectsProcessor.name);

  constructor(
    private readonly effects: SubmissionEffectsService,
    @InjectModel(Submission.name)
    private readonly submissions: Model<Submission>,
  ) {
    super();
  }

  /** The stats count is hinted to a submissions index. */
  onApplicationBootstrap(): Promise<void> {
    return startAfterIndexes(this.worker, this.submissions);
  }

  process(job: Job<SubmissionGradedJob>): Promise<void> {
    return this.effects.apply(job.data);
  }

  /** Retried by the job's attempts; the sweep recomputes what still fails. */
  @OnWorkerEvent('failed')
  onFailed(job: Job<SubmissionGradedJob> | undefined, error: Error): void {
    this.logger.error(
      `Effects of submission ${job?.data.submissionId} failed: ${error.message}`,
    );
  }
}
