import type { Job, JobType, Queue } from 'bullmq';
import type { PolygonImportJob, PolygonImportResult } from '@libs/problems';

export type ImportQueue = Queue<PolygonImportJob, PolygonImportResult>;
export type ImportJob = Job<PolygonImportJob, PolygonImportResult>;

/** States of a job that has not ended: queued (also while it waits for a retry) or running. */
const UNFINISHED: JobType[] = ['active', 'waiting', 'delayed', 'prioritized'];
const FINISHED = new Set(['completed', 'failed']);

/** True while the job with this id is queued or running. */
export async function isUnfinished(
  queue: ImportQueue,
  jobId: string,
): Promise<boolean> {
  const job = await queue.getJob(jobId);
  return Boolean(job && !FINISHED.has(await job.getState()));
}

/** A finished job is kept a day, and BullMQ ignores an `add` with its id meanwhile: a new sync of the same package replaces it. */
export async function removeFinished(
  queue: ImportQueue,
  jobId: string,
): Promise<void> {
  const job = await queue.getJob(jobId);
  if (job && FINISHED.has(await job.getState())) await job.remove();
}

/** The newest queued or running job that imports into `code`; null when none. */
export async function unfinishedJobOf(
  queue: ImportQueue,
  code: string,
): Promise<ImportJob | null> {
  const jobs = (await queue.getJobs(UNFINISHED)).filter(
    (job): job is ImportJob => job?.data.code === code,
  );
  return (
    jobs.sort((left, right) => right.timestamp - left.timestamp)[0] ?? null
  );
}
