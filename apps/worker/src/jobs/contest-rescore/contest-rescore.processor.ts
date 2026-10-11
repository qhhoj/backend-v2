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
import { CONTEST_RESCORE_QUEUE } from '@libs/contests';
import type { ContestRescoreJob } from '@libs/contests';
import { Submission } from '@libs/database';
import { startAfterIndexes } from '../start-after-indexes';
import { ContestRescoreService } from './contest-rescore.service';

@Processor(CONTEST_RESCORE_QUEUE, { concurrency: 1, autorun: false })
export class ContestRescoreProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(ContestRescoreProcessor.name);

  constructor(
    private readonly rescores: ContestRescoreService,
    @InjectQueue(CONTEST_RESCORE_QUEUE)
    private readonly queue: Queue<ContestRescoreJob>,
    @InjectModel(Submission.name)
    private readonly submissions: Model<Submission>,
  ) {
    super();
  }

  /** One contest rescore at a time across worker processes; each run reads the contest's current state, so the run queued by the last edit settles it (like `problem-rescore`). The limit is a Redis meta key: a flush drops it until the next boot. Consumption waits for the submissions indexes like its siblings (`startAfterIndexes`). */
  async onApplicationBootstrap(): Promise<void> {
    await this.queue.setGlobalConcurrency(1);
    await startAfterIndexes(this.worker, this.submissions);
  }

  process(
    job: Job<ContestRescoreJob>,
  ): Promise<{ rescored: number; participations: number }> {
    const { contestId, problemId, participationId } = job.data;
    return this.rescores.rescore(contestId, { problemId, participationId });
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<ContestRescoreJob> | undefined, error: Error): void {
    this.logger.error(
      `Rescore of contest ${job?.data.contestId} failed: ${error.message}`,
    );
  }
}
