import { Logger } from '@nestjs/common';
import type { JobsOptions, Queue } from 'bullmq';
import { withinTimeout } from '../util/within-timeout';
import type { JobContract } from './job-contract';

/** Longest a request or a packet waits for a best-effort job to reach Redis. */
export const ENQUEUE_TIMEOUT_MS = 1000;

export interface AddOptions {
  /** Overrides the contract's `jobId` (a key the payload does not carry, like the bridge's judge-run generation). */
  jobId?: string;
}

/** Adds one contract's jobs to its queue; injected with `@InjectJob(contract)`. */
export class JobProducer<Payload> {
  private readonly logger = new Logger(JobProducer.name);

  constructor(
    readonly contract: JobContract<Payload>,
    private readonly queue: Queue,
  ) {}

  /**
   * Best effort, for work whose state is already in Mongo: bounded by `ENQUEUE_TIMEOUT_MS`, logged, never thrown, false when not confirmed (a late add is still delivered when Redis returns).
   * Redis is a hint: the owner's sweep or next trigger repairs a lost job (decisions.md:156).
   */
  async enqueue(payload: Payload, options: AddOptions = {}): Promise<boolean> {
    try {
      await withinTimeout(this.add(payload, options), ENQUEUE_TIMEOUT_MS);
      return true;
    } catch (error) {
      this.logger.error(
        `${this.contract.describe(payload)} not enqueued: ${(error as Error).message}`,
      );
      return false;
    }
  }

  /** Awaited and thrown, for a request that fails when its job is not queued. */
  async add(payload: Payload, options: AddOptions = {}): Promise<void> {
    await this.queue.add(
      this.contract.name,
      payload,
      this.optionsOf(payload, options),
    );
  }

  /** `add` for many payloads in one round trip. */
  async addBulk(payloads: readonly Payload[]): Promise<void> {
    await this.queue.addBulk(
      payloads.map((payload) => ({
        name: this.contract.name,
        data: payload,
        opts: this.optionsOf(payload),
      })),
    );
  }

  private optionsOf(payload: Payload, options: AddOptions = {}): JobsOptions {
    const jobId = options.jobId ?? this.contract.jobId?.(payload);
    return { ...this.contract.options, ...(jobId && { jobId }) };
  }
}
