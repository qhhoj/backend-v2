import type { Job, JobType } from 'bullmq';
import type { JobProducer } from '@libs/common';
import type { PolygonImportJob, PolygonImportResult } from '@libs/problems';

/** Reads the import queue: uploads, link imports and syncs alike. */
export type ImportQueue = JobProducer<PolygonImportJob>;
export type ImportJob = Job<PolygonImportJob, PolygonImportResult>;

/** States of a job that has not ended: queued (also while it waits for a retry) or running. */
const UNFINISHED: JobType[] = ['active', 'waiting', 'delayed', 'prioritized'];
const FINISHED = new Set(['completed', 'failed']);

const jobsIn = async (
  queue: ImportQueue,
  types: JobType[],
  ascending?: boolean,
): Promise<ImportJob[]> =>
  (await queue.jobs(types, 0, -1, ascending)) as ImportJob[];

/** The job with this id while it is queued or running; null otherwise. */
export async function unfinishedJob(
  queue: ImportQueue,
  jobId: string,
): Promise<ImportJob | null> {
  const job = await queue.job(jobId);
  return job && !FINISHED.has(await job.getState()) ? job : null;
}

/** A finished job is kept a day, and BullMQ ignores an `add` with its id meanwhile: a new sync of the same package replaces it. */
export async function removeFinished(
  queue: ImportQueue,
  jobId: string,
): Promise<void> {
  const job = await queue.job(jobId);
  if (job && FINISHED.has(await job.getState())) await job.remove();
}

/** The newest queued or running job that imports into the problem; null when none. */
export async function unfinishedJobOf(
  queue: ImportQueue,
  problemId: string,
): Promise<ImportJob | null> {
  const jobs = (await jobsIn(queue, UNFINISHED)).filter(
    (job): job is ImportJob => job?.data.problemId === problemId,
  );
  return (
    jobs.sort((left, right) => right.timestamp - left.timestamp)[0] ?? null
  );
}

/** 1-based place of every queued job in the order the worker takes them: jobs without a priority oldest first, then prioritized ones (automatic syncs), behind the running ones. */
export async function queuePositionsOf(
  queue: ImportQueue,
): Promise<Map<string, number>> {
  const [active, waiting, prioritized] = await Promise.all([
    queue.count('active'),
    jobsIn(queue, ['waiting'], true),
    jobsIn(queue, ['prioritized'], true),
  ]);
  return new Map(
    [...waiting, ...prioritized]
      .filter((job): job is ImportJob => Boolean(job?.id))
      .map((job, index) => [job.id!, active + index + 1]),
  );
}

/** The jobs a user started that the queue still keeps (a day after they ended), newest first. */
export async function jobsOf(
  queue: ImportQueue,
  userId: string,
): Promise<ImportJob[]> {
  const jobs = await jobsIn(queue, [...UNFINISHED, 'completed', 'failed']);
  return jobs
    .filter((job): job is ImportJob => job?.data.requesterId === userId)
    .sort(
      (left, right) =>
        right.timestamp - left.timestamp ||
        (right.id ?? '').localeCompare(left.id ?? ''),
    );
}
