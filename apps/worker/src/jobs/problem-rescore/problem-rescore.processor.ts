import { InjectModel } from '@nestjs/mongoose';
import {
  InjectQueue,
  OnWorkerEvent,
  Processor,
  WorkerHost,
} from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import type { Model } from 'mongoose';
import { Submission } from '@libs/database';
import { PROBLEM_RESCORE_QUEUE } from '@libs/judging';
import type { ProblemRescoreJob } from '@libs/judging';
import { startAfterIndexes } from '../start-after-indexes';
import { ProblemRescoreService } from './problem-rescore.service';

@Processor(PROBLEM_RESCORE_QUEUE, { concurrency: 1, autorun: false })
export class ProblemRescoreProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(ProblemRescoreProcessor.name);

  constructor(
    private readonly rescores: ProblemRescoreService,
    @InjectQueue(PROBLEM_RESCORE_QUEUE)
    private readonly queue: Queue<ProblemRescoreJob>,
    @InjectModel(Submission.name)
    private readonly submissions: Model<Submission>,
  ) {
    super();
  }

  /** One rescore at a time across worker processes: two interleaved rescores of one problem could write the older points last. Each run reads the problem's current points, so the run queued by the last edit settles it. The limit is a Redis meta key: a flush drops it until the next boot. The stats count is hinted to a submissions index. */
  async onApplicationBootstrap(): Promise<void> {
    await this.queue.setGlobalConcurrency(1);
    await startAfterIndexes(this.worker, this.submissions);
  }

  process(
    job: Job<ProblemRescoreJob>,
  ): Promise<{ rescored: number; users: number }> {
    return this.rescores.rescore(job.data.problemId);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<ProblemRescoreJob> | undefined, error: Error): void {
    this.logger.error(
      `Rescore of problem ${job?.data.problemId} failed: ${error.message}`,
    );
  }
}
