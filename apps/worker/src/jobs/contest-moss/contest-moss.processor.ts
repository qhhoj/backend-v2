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
import { CONTEST_MOSS_QUEUE } from '@libs/contests';
import type { ContestMossJob } from '@libs/contests';
import { Submission } from '@libs/database';
import { startAfterIndexes } from '../start-after-indexes';
import { ContestMossService } from './contest-moss.service';

@Processor(CONTEST_MOSS_QUEUE, { concurrency: 1, autorun: false })
export class ContestMossProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(ContestMossProcessor.name);

  constructor(
    private readonly moss: ContestMossService,
    @InjectQueue(CONTEST_MOSS_QUEUE)
    private readonly queue: Queue<ContestMossJob>,
    @InjectModel(Submission.name)
    private readonly submissions: Model<Submission>,
  ) {
    super();
  }

  /** One MOSS session at a time across worker processes, as one legacy Celery task. Consumption waits for the indexes like its siblings (`startAfterIndexes`). */
  async onApplicationBootstrap(): Promise<void> {
    await this.queue.setGlobalConcurrency(1);
    await startAfterIndexes(this.worker, this.submissions);
  }

  process(job: Job<ContestMossJob>): Promise<number> {
    return this.moss.run(job.data.contestId);
  }

  /** `MossError` messages are keyless by construction. */
  @OnWorkerEvent('failed')
  onFailed(job: Job<ContestMossJob> | undefined, error: Error): void {
    this.logger.error(
      `MOSS for contest ${job?.data.contestId} failed: ${error.message}`,
    );
  }
}
