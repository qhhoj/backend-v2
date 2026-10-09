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
import { CONTEST_REPLAY_QUEUE } from '@libs/contests';
import type { ContestReplayJob } from '@libs/contests';
import { Submission } from '@libs/database';
import { startAfterIndexes } from '../start-after-indexes';
import { ContestReplayService } from './contest-replay.service';

@Processor(CONTEST_REPLAY_QUEUE, { concurrency: 1, autorun: false })
export class ContestReplayProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(ContestReplayProcessor.name);

  constructor(
    private readonly replays: ContestReplayService,
    @InjectQueue(CONTEST_REPLAY_QUEUE)
    private readonly queue: Queue<ContestReplayJob>,
    @InjectModel(Submission.name)
    private readonly submissions: Model<Submission>,
  ) {
    super();
  }

  /** One replay build at a time across worker processes (a Redis meta key, like `contest-rescore`); consumption waits for the submissions indexes because the scoring rows read hints to one. */
  async onApplicationBootstrap(): Promise<void> {
    await this.queue.setGlobalConcurrency(1);
    await startAfterIndexes(this.worker, this.submissions);
  }

  process(job: Job<ContestReplayJob>): Promise<{ events: number }> {
    return this.replays.build(job.data.contestId);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<ContestReplayJob> | undefined, error: Error): void {
    this.logger.error(
      `Replay of contest ${job?.data.contestId} failed: ${error.message}`,
    );
  }
}
