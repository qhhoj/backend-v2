import {
  InjectQueue,
  OnWorkerEvent,
  Processor,
  WorkerHost,
} from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { PROBLEM_RESCORE_QUEUE } from '@libs/judging';
import type { ProblemRescoreJob } from '@libs/judging';
import { ProblemRescoreService } from './problem-rescore.service';

@Processor(PROBLEM_RESCORE_QUEUE, { concurrency: 1 })
export class ProblemRescoreProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(ProblemRescoreProcessor.name);

  constructor(
    private readonly rescores: ProblemRescoreService,
    @InjectQueue(PROBLEM_RESCORE_QUEUE)
    private readonly queue: Queue<ProblemRescoreJob>,
  ) {
    super();
  }

  /** One rescore at a time across worker processes: two interleaved rescores of one problem could write the older points last. Each run reads the problem's current points, so the run queued by the last edit settles it. */
  async onApplicationBootstrap(): Promise<void> {
    await this.queue.setGlobalConcurrency(1);
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
