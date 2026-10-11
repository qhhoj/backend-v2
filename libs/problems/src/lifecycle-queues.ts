import type { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { JOB_RETENTION, JOB_RETRY, withinTimeout } from '@libs/judging';

/** Longest a delete or restore waits for its follow-up job to reach Redis. */
const LIFECYCLE_ENQUEUE_TIMEOUT_MS = 1000;

export const PROBLEM_SOLVERS_QUEUE = 'problem-solvers-recompute';
const PROBLEM_SOLVERS_JOB = 'recompute';
export type SolversRecomputeReason = 'deleted' | 'restored';
/** Recompute the points of every user with a submission to the problem, after it was deleted or restored (deleted problems do not count for points). */
export interface ProblemSolversJob {
  problemId: string;
  reason: SolversRecomputeReason;
}

/** No `jobId`: a delete followed by a restore must queue both. Never throws: the change is committed; the effects sweep and the next graded submission recompute a user anyway (logged). */
export async function notifySolversRecompute(
  queue: Queue<ProblemSolversJob>,
  job: ProblemSolversJob,
  logger: Logger,
): Promise<void> {
  try {
    await withinTimeout(
      queue.add(PROBLEM_SOLVERS_JOB, job, { ...JOB_RETRY, ...JOB_RETENTION }),
      LIFECYCLE_ENQUEUE_TIMEOUT_MS,
    );
  } catch (error) {
    logger.error(
      `Recompute for the solvers of problem ${job.problemId} (${job.reason}) not enqueued: ${(error as Error).message}`,
    );
  }
}

export const PROBLEM_PURGE_QUEUE = 'problem-purge';
const PROBLEM_PURGE_JOB = 'purge';
export const PROBLEM_PURGE_SWEEP_JOB = 'sweep';
export const PROBLEM_PURGE_SCHEDULER = 'problem-purge-daily';
/** 03:30 every day, in the site time zone. */
export const PROBLEM_PURGE_PATTERN = '30 3 * * *';
/** Remove the problem's heavy assets and leave a tombstone; submissions stay. */
export interface ProblemPurgeJob {
  problemId: string;
}
export const problemPurgeJobId = (problemId: string): string =>
  `problem-purge-${problemId}`;

/** One job per problem at a time (`jobId`); a finished job is removed, so a later request can queue again. A job that failed all its attempts is kept for a week and would swallow a new `add` with the same id, so it is removed first (preflight I5). */
export async function enqueuePurge(
  queue: Queue<ProblemPurgeJob>,
  problemId: string,
): Promise<void> {
  const previous = await queue.getJob(problemPurgeJobId(problemId));
  if (previous && (await previous.isFailed())) await previous.remove();
  await queue.add(
    PROBLEM_PURGE_JOB,
    { problemId },
    { jobId: problemPurgeJobId(problemId), ...JOB_RETRY, ...JOB_RETENTION },
  );
}

export const PACKAGE_QUEUE = 'problem-package';
export const PACKAGE_JOB = 'build';
export const PACKAGE_SWEEP_JOB = 'sweep';
export const PACKAGE_SWEEP_SCHEDULER = 'problem-package-sweep-daily';
export const PACKAGE_SWEEP_PATTERN = '15 4 * * *';
export const PACKAGE_MAX_BYTES = 512 * 1024 * 1024;
/** Total size of the package cache; past it the oldest zips are evicted (a package build is bounded per problem, not in sum). */
export const PACKAGE_CACHE_MAX_BYTES = 8 * 1024 * 1024 * 1024;
/** A cached package older than this is deleted by the daily sweep. */
export const PACKAGE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** The failure reason of a build over the size cap; the api turns it into `409 package_too_large`. */
const PACKAGE_ERROR_PREFIX = 'problem-package: ';
export const PACKAGE_TOO_LARGE_REASON = `${PACKAGE_ERROR_PREFIX}too_large`;
/** `key` names the exact content the api saw (`<dataVersion>.<contentHash>`). */
export interface ProblemPackageJob {
  code: string;
  key: string;
}
/** One build per problem and key (BullMQ ids cannot contain `:`). */
export const packageJobId = (code: string, key: string): string =>
  `package-${code}-${key}`;
