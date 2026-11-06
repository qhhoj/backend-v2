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
import { SITE_TIME_ZONE } from './job-contract';
import type { JobContract, JobSchedule } from './job-contract';

export abstract class ContractProcessor<Payload, Result>
  extends WorkerHost
  implements OnApplicationBootstrap
{
  declare protected readonly contract: JobContract<Payload>;
  declare protected readonly sweepContract: JobContract<void> | undefined;
  protected readonly logger = new Logger(this.constructor.name);
  @Inject(ModuleRef) private readonly moduleRef!: ModuleRef;

  abstract run(payload: Payload, job: Job<Payload>): Promise<Result>;

  /** The scheduled sweep that shares the queue (`JobProcessor(contract, sweep)`). */
  sweep?(): Promise<unknown>;

  /** After a failed attempt, once it is logged; the job's own retries go on. */
  protected onFailure?(payload: Payload, error: Error): Promise<void>;

  /** Any name but the sweep's runs `run`, as each queue's processor did before contracts. */
  process(job: Job<Payload>): Promise<unknown> {
    return this.sweepOf(job) && this.sweep
      ? this.sweep()
      : this.run(job.data, job);
  }

  async onApplicationBootstrap(): Promise<void> {
    const served = [this.contract, this.sweepContract].filter(
      (contract) => contract !== undefined,
    );
    const queue = this.resolve<Queue>(getQueueToken(this.contract.queue));
    if (this.contract.oneAtATime) await queue.setGlobalConcurrency(1);
    for (const { schedule, name, options } of served)
      if (schedule)
        await queue.upsertJobScheduler(schedule.id, this.repeatOf(schedule), {
          name,
          opts: options,
        });
    await Promise.all(
      served
        .flatMap(({ needsIndexes }) => needsIndexes)
        .map((model) =>
          this.resolve<{ init(): Promise<unknown> }>(
            getModelToken(model.name),
          ).init(),
        ),
    );
    if (!this.worker.isRunning()) void this.worker.run();
  }

  @OnWorkerEvent('failed')
  async failed(job: Job<Payload> | undefined, error: Error): Promise<void> {
    if (!job)
      return this.logger.error(
        `${this.contract.name} job failed: ${error.message}`,
      );
    const sweep = this.sweepOf(job);
    this.logger.error(
      `${sweep ? sweep.describe() : this.contract.describe(job.data)} failed: ${error.message}`,
    );
    if (!sweep && this.onFailure) await this.onFailure(job.data, error);
  }

  /** Without a listener a worker error (e.g. Redis flushed under a running job) is an unhandled event and throws. */
  @OnWorkerEvent('error')
  error(error: Error): void {
    this.logger.error(`${this.contract.queue} worker error: ${error.message}`);
  }

  /** The sweep's contract when the job is a run of it. */
  private sweepOf(job: Job): JobContract<void> | undefined {
    return job.name === this.sweepContract?.name
      ? this.sweepContract
      : undefined;
  }

  private repeatOf(
    schedule: JobSchedule,
  ): { every: number } | { pattern: string; tz: string } {
    return 'every' in schedule
      ? { every: schedule.every }
      : {
          pattern: schedule.pattern,
          tz: this.resolve<() => string>(SITE_TIME_ZONE)(),
        };
  }

  private resolve<T>(token: string): T {
    return this.moduleRef.get<T>(token, { strict: false });
  }
}

/** A processor class made by `JobProcessor`: the contracts it consumes, for the contract spec. */
export interface ContractProcessorClass {
  readonly served: readonly JobContract<never>[];
}

/**
 * Base of the one worker class that consumes a queue: `class X extends JobProcessor(contract)` implements `run`, and may add `onFailure`.
 * A queue that also carries a scheduled sweep names it as `sweep` and implements `sweep()`; concurrency and the one-at-a-time limit are the main contract's.
 * At boot it sets the global one-at-a-time limit, upserts the schedules, then starts consuming once the `needsIndexes` models' indexes exist.
 */
export function JobProcessor<Payload, Result = unknown>(
  contract: JobContract<Payload>,
  sweep?: JobContract<void>,
): (abstract new () => ContractProcessor<Payload, Result>) &
  ContractProcessorClass {
  if (sweep && sweep.queue !== contract.queue)
    throw new Error(`${sweep.name} is not on queue ${contract.queue}`);
  @Processor(contract.queue, {
    concurrency: contract.concurrency,
    autorun: false,
  })
  abstract class BoundProcessor extends ContractProcessor<Payload, Result> {
    static readonly served = [contract, sweep].filter(
      (served) => served !== undefined,
    ) as JobContract<never>[];
    protected readonly contract = contract;
    protected readonly sweepContract = sweep;
  }
  return BoundProcessor;
}
