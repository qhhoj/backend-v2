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
import {
  CONTEST_FINAL_JUDGE_QUEUE,
  CONTEST_FINAL_JUDGE_SCHEDULER,
  CONTEST_FINAL_JUDGE_SWEEP_JOB,
  FINAL_JUDGE_SWEEP_MS,
} from '@libs/contests';
import type { ContestFinalJudgeJob } from '@libs/contests';
import { Submission } from '@libs/database';
import { startAfterIndexes } from '../start-after-indexes';
import { ContestFinalJudgeService } from './contest-final-judge.service';

@Processor(CONTEST_FINAL_JUDGE_QUEUE, { concurrency: 1, autorun: false })
export class ContestFinalJudgeProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(ContestFinalJudgeProcessor.name);

  constructor(
    private readonly finalJudging: ContestFinalJudgeService,
    @InjectQueue(CONTEST_FINAL_JUDGE_QUEUE) private readonly queue: Queue,
    @InjectModel(Submission.name)
    private readonly submissions: Model<Submission>,
  ) {
    super();
  }

  /** One schedule for every worker process (the upsert is idempotent); overlapping sweeps are harmless, each contest's run is serialised. Consumption waits for the submissions indexes like its siblings (`startAfterIndexes`). */
  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      CONTEST_FINAL_JUDGE_SCHEDULER,
      { every: FINAL_JUDGE_SWEEP_MS },
      {
        name: CONTEST_FINAL_JUDGE_SWEEP_JOB,
        opts: { removeOnComplete: true, removeOnFail: 100 },
      },
    );
    await startAfterIndexes(this.worker, this.submissions);
  }

  process(job: Job<ContestFinalJudgeJob>): Promise<number> {
    return job.name === CONTEST_FINAL_JUDGE_SWEEP_JOB
      ? this.finalJudging.sweep()
      : this.finalJudging.judgeFinal(job.data.contestId, {
          isManual: job.data.manual,
        });
  }

  @OnWorkerEvent('error')
  onError(error: Error): void {
    this.logger.error(`Final judging worker error: ${error.message}`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<ContestFinalJudgeJob> | undefined, error: Error): void {
    this.logger.error(
      `Final judging ${job?.name} ${job?.data.contestId ?? ''} failed: ${error.message}`,
    );
  }
}
