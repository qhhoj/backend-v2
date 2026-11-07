import { Logger } from '@nestjs/common';
import type { Job, JobType, JobsOptions, Queue } from 'bullmq';
import { withinTimeout } from '../util/within-timeout';
import type { JobContract } from './job-contract';

/** Longest a request or a packet waits for a best-effort job to reach Redis. */
export const ENQUEUE_TIMEOUT_MS = 1000;

/** What one add may set beyond the contract: a key the payload does not carry, a start time, a debounce. */
export type AddOptions = Pick<JobsOptions, 'jobId' | 'delay' | 'deduplication'>;

/** Adds one contract's jobs to its queue and reads them back; injected with `@InjectJob(contract)`. */
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
  enqueue(payload: Payload, options: AddOptions = {}): Promise<boolean> {
    return this.bestEffort(
      `${this.contract.describe(payload)} not enqueued`,
      () => this.add(payload, options),
    );
  }

  /** Removes a waiting, delayed or ended job by id, awaited and thrown; a job already running stays. */
  async remove(jobId: string): Promise<void> {
    await this.queue.remove(jobId);
  }

  /** Removes a waiting or delayed job by id, best effort like `enqueue`; a job already running stays. */
  withdraw(jobId: string): Promise<boolean> {
    return this.bestEffort(
      `${this.contract.name} job ${jobId} not removed`,
      () => this.queue.remove(jobId),
    );
  }

  /** The one best-effort policy, for a request made of several queue calls: bounded, logged as `<failure>: <reason>`, never thrown. */
  async bestEffort(
    failure: string,
    call: () => Promise<unknown>,
  ): Promise<boolean> {
    try {
      await withinTimeout(call(), ENQUEUE_TIMEOUT_MS);
      return true;
    } catch (error) {
      this.logger.error(`${failure}: ${(error as Error).message}`);
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

  /** `add` under the contract's job id, after removing a failed job kept under it (it would swallow the add); a queued or running one is kept, and the add is ignored. */
  async addReplacingFailed(payload: Payload): Promise<void> {
    const previous = await this.job(this.idOf(payload));
    if (previous && (await previous.isFailed())) await previous.remove();
    await this.add(payload);
  }

  /** Removes `job` when it is a delayed job of this contract, so a later add replaces it; false when it is not, or a worker took it meanwhile. */
  async preempt(job: Job): Promise<boolean> {
    if (job.name !== this.contract.name) return false;
    if ((await job.getState()) !== 'delayed') return false;
    return job.remove().then(
      () => true,
      () => false,
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

  /** The job with this id while BullMQ keeps it. */
  async job(jobId: string): Promise<Job<Payload> | undefined> {
    return (await this.queue.getJob(jobId)) ?? undefined;
  }

  /** Jobs of the queue in these states (BullMQ's `getJobs` range and order). */
  jobs(
    types: JobType[],
    start?: number,
    end?: number,
    asc?: boolean,
  ): Promise<Job<Payload>[]> {
    return this.queue.getJobs(types, start, end, asc) as Promise<
      Job<Payload>[]
    >;
  }

  /** How many jobs of the queue are in these states. */
  count(...types: JobType[]): Promise<number> {
    return this.queue.getJobCountByTypes(...types);
  }

  /** The contract's job id of a payload; a contract without one cannot keep a job per payload. */
  idOf(payload: Payload): string {
    const jobId = this.contract.jobId?.(payload);
    if (!jobId) throw new Error(`${this.contract.name} jobs have no job id`);
    return jobId;
  }

  private optionsOf(
    payload: Payload,
    { jobId: explicitId, ...options }: AddOptions = {},
  ): JobsOptions {
    const jobId = explicitId ?? this.contract.jobId?.(payload);
    return { ...this.contract.options, ...options, ...(jobId && { jobId }) };
  }
}
