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
import { CONTEST_RATING_QUEUE } from '@libs/contests';
import type { ContestRatingJob } from '@libs/contests';
import { Submission } from '@libs/database';
import { startAfterIndexes } from '../start-after-indexes';
import { ContestRatingService } from './contest-rating.service';

@Processor(CONTEST_RATING_QUEUE, { concurrency: 1, autorun: false })
export class ContestRatingProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(ContestRatingProcessor.name);

  constructor(
    private readonly ratings: ContestRatingService,
    @InjectQueue(CONTEST_RATING_QUEUE)
    private readonly queue: Queue<ContestRatingJob>,
    @InjectModel(Submission.name)
    private readonly submissions: Model<Submission>,
  ) {
    super();
  }

  /** One rating run at a time across worker processes: two interleaved chains would rate against each other's half-deleted histories. The limit is a Redis meta key: a flush drops it until the next boot. Consumption waits for the indexes like its siblings (`startAfterIndexes`). */
  async onApplicationBootstrap(): Promise<void> {
    await this.queue.setGlobalConcurrency(1);
    await startAfterIndexes(this.worker, this.submissions);
  }

  process(
    job: Job<ContestRatingJob>,
  ): Promise<{ contests: number; ratings: number }> {
    return this.ratings.rateFrom(job.data.contestId);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<ContestRatingJob> | undefined, error: Error): void {
    this.logger.error(
      `Rating from contest ${job?.data.contestId} failed: ${error.message}`,
    );
  }
}
