import {
  getQueueToken,
  OnWorkerEvent,
  Processor,
  WorkerHost,
} from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import type { Job, Queue } from 'bullmq';
import type { JobContract } from './job-contract';

/** How many processor classes extend each contract, for the contract spec. */
export const JOB_PROCESSORS = new Map<JobContract<never>, number>();

export abstract class ContractProcessor<Payload, Result>
  extends WorkerHost
  implements OnApplicationBootstrap
{
  declare protected readonly contract: JobContract<Payload>;
  protected readonly logger = new Logger(this.constructor.name);
  @Inject(ModuleRef) private readonly moduleRef!: ModuleRef;

  abstract run(payload: Payload, job: Job<Payload>): Promise<Result>;

  /** After a failed attempt, once it is logged; the job's own retries go on. */
  protected onFailure?(payload: Payload, error: Error): Promise<void>;

  process(job: Job<Payload>): Promise<Result> {
    return this.run(job.data, job);
  }

  async onApplicationBootstrap(): Promise<void> {
    const { queue, oneAtATime, schedule, name, options, needsIndexes } =
      this.contract;
    const queueRef = this.resolve<Queue>(getQueueToken(queue));
    if (oneAtATime) await queueRef.setGlobalConcurrency(1);
    if (schedule)
      await queueRef.upsertJobScheduler(schedule.id, schedule.repeat, {
        name,
        opts: options,
      });
    await Promise.all(
      needsIndexes.map((model) =>
        this.resolve<{ init(): Promise<unknown> }>(
          getModelToken(model.name),
        ).init(),
      ),
    );
    if (!this.worker.isRunning()) void this.worker.run();
  }

  @OnWorkerEvent('failed')
  async failed(job: Job<Payload> | undefined, error: Error): Promise<void> {
    const subject = job
      ? this.contract.describe(job.data)
      : `${this.contract.name} job`;
    this.logger.error(`${subject} failed: ${error.message}`);
    if (job && this.onFailure) await this.onFailure(job.data, error);
  }

  /** Without a listener a worker error (e.g. Redis flushed under a running job) is an unhandled event and throws. */
  @OnWorkerEvent('error')
  error(error: Error): void {
    this.logger.error(`${this.contract.queue} worker error: ${error.message}`);
  }

  private resolve<T>(token: string): T {
    return this.moduleRef.get<T>(token, { strict: false });
  }
}

/**
 * Base of the one worker class that consumes a contract: `class X extends JobProcessor(contract)` implements `run`, and may add `onFailure`.
 * At boot it sets the global one-at-a-time limit, upserts the schedule, then starts consuming once the `needsIndexes` models' indexes exist.
 */
export function JobProcessor<Payload, Result = unknown>(
  contract: JobContract<Payload>,
): abstract new () => ContractProcessor<Payload, Result> {
  const key = contract as JobContract<never>;
  JOB_PROCESSORS.set(key, (JOB_PROCESSORS.get(key) ?? 0) + 1);
  @Processor(contract.queue, {
    concurrency: contract.concurrency,
    autorun: false,
  })
  abstract class BoundProcessor extends ContractProcessor<Payload, Result> {
    protected readonly contract = contract;
  }
  return BoundProcessor;
}
