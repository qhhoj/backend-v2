import type { JobsOptions } from 'bullmq';

/** Finished jobs are dropped at once; failed ones stay a week for inspection. */
export const JOB_RETENTION = {
  removeOnComplete: true,
  removeOnFail: { age: 7 * 24 * 60 * 60 },
};
/** Three tries, 10 s then 20 s apart (BullMQ doubles the delay): for idempotent recomputes. */
export const JOB_RETRY = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 10_000 },
};
/** One attempt, dropped as soon as it ends either way: with a job id per subject, "running" is "the job exists" (an add with a live id is ignored), and a failure never blocks the next request. */
export const ONE_SHOT_JOB = {
  attempts: 1,
  removeOnComplete: true,
  removeOnFail: true,
};
/** A scheduled run keeps its last 100 failures; the next run repeats the work anyway. */
export const SCHEDULED_RETENTION = {
  removeOnComplete: true,
  removeOnFail: 100,
};

/** A schema class whose Mongoose model the job's queries rely on (a hint, or a unique index that makes a write idempotent). */
export interface IndexedModel {
  readonly name: string;
}

/** A recurring run: every so many milliseconds, or a cron pattern read in the site time zone (setting `site.timeZone`, read at boot). */
export type JobSchedule = {
  /** The scheduler key in Redis; the upsert is idempotent, so every worker process runs it. */
  id: string;
} & ({ every: number } | { pattern: string; tz: 'site' });

/** Retry, retention and priority: the options a contract fixes for every add. */
export type ContractOptions = Pick<
  JobsOptions,
  'attempts' | 'backoff' | 'removeOnComplete' | 'removeOnFail' | 'priority'
>;

/** Provides `() => string`, the site's IANA time zone, for pattern schedules (the settings module provides it; common cannot read settings). */
export const SITE_TIME_ZONE = 'SITE_TIME_ZONE';

/** Everything api, worker and bridge must agree on for one kind of job. Queue, name, job id and options are what Redis holds, so they never change for a job already queued. */
export interface JobContract<Payload> {
  readonly queue: string;
  readonly name: string;
  /** Retry, retention and priority of every add (and of scheduled runs). */
  readonly options: ContractOptions;
  /** A job id derived from the payload: BullMQ ignores an add whose id is still kept. */
  readonly jobId?: (payload: Payload) => string;
  /** Subject of the log lines about one job, e.g. `Rescore of problem <id>`. */
  readonly describe: (payload: Payload) => string;
  /** Jobs one worker process runs at once. */
  readonly concurrency: number;
  /** One job at a time across every worker process (a Redis meta key; a flush drops it until the next boot). */
  readonly oneAtATime: boolean;
  readonly schedule?: JobSchedule;
  /** Consumption starts once these models' indexes exist: Mongo rejects a hint to a missing index (decisions.md:196). */
  readonly needsIndexes: readonly IndexedModel[];
  /**
   * Opt-in: a job BullMQ failed as stalled out (worker lost its lock twice, no attempt spent) is queued again while attempts are left. Set it only when `run` is safe when two runs overlap (a run that lost its lock may still be live): compare-and-set or coalesced recomputes. Not for effects that cannot be repeated (a webhook post, a whole import).
   */
  readonly requeueWhenStalledOut?: boolean;
  /** Marks a failed reason as a `JobFailure` written for the job's reader (`failureOf`); any other reason stays in the logs. */
  readonly failurePrefix?: string;
}

/**
 * A failure the job's reader may see: thrown by the worker, stored by BullMQ as `<failurePrefix><message>`, read back with `failureOf`.
 * `final`: no attempt is left (stored as BullMQ's `UnrecoverableError`).
 */
export class JobFailure extends Error {
  constructor(
    message: string,
    readonly final = false,
  ) {
    super(message);
  }
}

/** The message of a `JobFailure` the job ended with; null for any other failed reason, or none. */
export function failureOf(
  contract: Pick<JobContract<never>, 'failurePrefix'>,
  job: { failedReason?: string },
): string | null {
  const prefix = contract.failurePrefix;
  const reason = job.failedReason;
  return prefix && reason?.startsWith(prefix)
    ? reason.slice(prefix.length)
    : null;
}

/** Every contract declared in this process, for the contract spec. */
export const DECLARED_JOBS: JobContract<never>[] = [];

export function defineJob<Payload>(
  spec: Pick<JobContract<Payload>, 'queue' | 'name' | 'options' | 'describe'> &
    Partial<JobContract<Payload>>,
): JobContract<Payload> {
  const contract: JobContract<Payload> = {
    concurrency: 1,
    oneAtATime: false,
    needsIndexes: [],
    ...spec,
  };
  DECLARED_JOBS.push(contract);
  return contract;
}
