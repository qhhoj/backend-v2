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
import {
  EFFECTS_SWEEP_JOB,
  EFFECTS_SWEEP_QUEUE,
  EFFECTS_SWEEP_SCHEDULER,
} from '@libs/judging';
import { startAfterIndexes } from '../start-after-indexes';
import {
  EffectsSweepService,
  SWEEP_INTERVAL_MS,
} from './effects-sweep.service';

@Processor(EFFECTS_SWEEP_QUEUE, { concurrency: 1, autorun: false })
export class EffectsSweepProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(EffectsSweepProcessor.name);

  constructor(
    private readonly sweeps: EffectsSweepService,
    @InjectQueue(EFFECTS_SWEEP_QUEUE) private readonly queue: Queue,
    @InjectModel(Submission.name)
    private readonly submissions: Model<Submission>,
  ) {
    super();
  }

  /**
   * One schedule for every worker process (the upsert is idempotent). BullMQ adds the next run when the current one starts, so a slow sweep would overlap it on another process; global concurrency 1 makes the next one wait (no Redis lock).
   * BullMQ queues a first sweep when the schedule is created or its slot has passed, so a first boot or a restart after a missed slot sweeps at once; a warm restart within the interval does not. That sweep's window starts at the stored watermark less the overlap, so what it cannot see is a CE (no grading-begin, found by `date`) queued more than 20 minutes before it, and a grading that began more than 20 minutes before it (`judgedDate` is grading-begin) whose graded job was lost.
   * The window reads are index-bound.
   */
  async onApplicationBootstrap(): Promise<void> {
    await this.queue.setGlobalConcurrency(1);
    await this.queue.upsertJobScheduler(
      EFFECTS_SWEEP_SCHEDULER,
      { every: SWEEP_INTERVAL_MS },
      {
        name: EFFECTS_SWEEP_JOB,
        opts: { removeOnComplete: true, removeOnFail: 100 },
      },
    );
    await startAfterIndexes(this.worker, this.submissions);
  }

  process(): Promise<{ users: number; problems: number }> {
    return this.sweeps.sweep();
  }

  /** Without a listener a worker error (e.g. Redis flushed under a running job) is an unhandled event and throws. */
  @OnWorkerEvent('error')
  onError(error: Error): void {
    this.logger.error(`Effects sweep worker error: ${error.message}`);
  }

  @OnWorkerEvent('failed')
  onFailed(_job: Job | undefined, error: Error): void {
    this.logger.error(`Effects sweep failed: ${error.message}`);
  }
}
