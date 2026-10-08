import {
  InjectQueue,
  OnWorkerEvent,
  Processor,
  WorkerHost,
} from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Job, Queue } from 'bullmq';
import type { Model } from 'mongoose';
import { Submission } from '@libs/database';
import { SIMILARITY_QUEUE } from '@libs/judging';
import type { SimilarityJob } from '@libs/judging';
import { startAfterIndexes } from '../start-after-indexes';
import { SimilarityService } from './similarity.service';

@Processor(SIMILARITY_QUEUE, { concurrency: 1, autorun: false })
export class SimilarityProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(SimilarityProcessor.name);

  constructor(
    private readonly similarity: SimilarityService,
    @InjectQueue(SIMILARITY_QUEUE) private readonly queue: Queue<SimilarityJob>,
    @InjectModel(Submission.name)
    private readonly submissions: Model<Submission>,
  ) {
    super();
  }

  /** One run at a time across worker processes: each spawns an engine child of up to 2 GiB. Consumption waits for the indexes like its siblings (`startAfterIndexes`). */
  async onApplicationBootstrap(): Promise<void> {
    await this.queue.setGlobalConcurrency(1);
    await startAfterIndexes(this.worker, this.submissions);
  }

  /** Errors are not caught here: `run` records its own failures, and a shutdown must not look like a clean finish. */
  process(job: Job<SimilarityJob>): Promise<void> {
    return this.similarity.run(job.data.runId);
  }

  /** `run` records its own failures; this catches a job that died around it (stalled past its lock), which would otherwise leave the scope active until the api's stale-run release. */
  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<SimilarityJob> | undefined,
    error: Error,
  ): Promise<void> {
    this.logger.error(`Similarity job ${job?.id} failed: ${error.message}`);
    if (!job) return;
    try {
      await this.similarity.markFailed(job.data.runId, 'internal_error');
    } catch (markError) {
      const { name, message } = markError as Error;
      this.logger.error(
        `Could not mark similarity run ${job.data.runId} failed (${name}): ${message}`,
      );
    }
  }
}
