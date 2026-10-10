import {
  InjectQueue,
  OnWorkerEvent,
  Processor,
  WorkerHost,
} from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  COMMENT_NUMBERS_JOB,
  COMMENT_NUMBERS_JOB_ID,
  COMMENT_NUMBERS_QUEUE,
} from '@libs/community';
import { CommentNumbersService } from './comment-numbers.service';

@Processor(COMMENT_NUMBERS_QUEUE, { concurrency: 1 })
export class CommentNumbersProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(CommentNumbersProcessor.name);

  constructor(
    private readonly numbers: CommentNumbersService,
    @InjectQueue(COMMENT_NUMBERS_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  /** Every worker process adds the same job id; BullMQ keeps one. Completed and failed jobs are kept, which is what makes it one-off. */
  async onApplicationBootstrap(): Promise<void> {
    await this.queue.add(
      COMMENT_NUMBERS_JOB,
      {},
      {
        jobId: COMMENT_NUMBERS_JOB_ID,
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: false,
        removeOnFail: false,
      },
    );
  }

  process(): Promise<{ pages: number; comments: number }> {
    return this.numbers.backfill();
  }

  @OnWorkerEvent('error')
  onError(error: Error): void {
    this.logger.error(`comment numbers worker error: ${error.message}`);
  }

  @OnWorkerEvent('failed')
  onFailed(_job: unknown, error: Error): void {
    this.logger.error(`comment numbers backfill failed: ${error.message}`);
  }
}
