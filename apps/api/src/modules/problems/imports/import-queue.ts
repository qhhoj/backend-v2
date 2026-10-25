import type { Job, JobType, Queue } from 'bullmq';
import type { PolygonImportJob, PolygonImportResult } from '@libs/problems';

export type ImportQueue = Queue<PolygonImportJob, PolygonImportResult>;
export type ImportJob = Job<PolygonImportJob, PolygonImportResult>;

/** States of a job that has not ended: queued (also while it waits for a retry) or running. */
const UNFINISHED: JobType[] = ['active', 'waiting', 'delayed', 'prioritized'];
const FINISHED = new Set(['completed', 'failed']);

/** The job with this id while it is queued or running; null otherwise. */
export async function unfinishedJob(
  queue: ImportQueue,
  jobId: string,
): Promise<ImportJob | null> {
  const job = await queue.getJob(jobId);
  return job && !FINISHED.has(await job.getState()) ? job : null;
}

/** A delayed automatic sync (held for a running contest, or waiting out an outage) is removed, so a manual sync of the same package runs now instead of joining it; false when the job is none of those, or the worker took it meanwhile. */
export async function removeDelayedAutoSync(job: ImportJob): Promise<boolean> {
  if (job.data.polygon?.trigger !== 'auto') return false;
  if ((await job.getState()) !== 'delayed') return false;
  return job.remove().then(
    () => true,
    () => false,
  );
}

/** A finished job is kept a day, and BullMQ ignores an `add` with its id meanwhile: a new sync of the same package replaces it. */
export async function removeFinished(
  queue: ImportQueue,
  jobId: string,
): Promise<void> {
  const job = await queue.getJob(jobId);
  if (job && FINISHED.has(await job.getState())) await job.remove();
}

/** The newest queued or running job that imports into the problem; null when none. */
export async function unfinishedJobOf(
  queue: ImportQueue,
  problemId: string,
): Promise<ImportJob | null> {
  const jobs = (await queue.getJobs(UNFINISHED)).filter(
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
    queue.getActiveCount(),
    queue.getWaiting(),
    queue.getPrioritized(),
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
  const jobs = await queue.getJobs([...UNFINISHED, 'completed', 'failed']);
  return jobs
    .filter((job): job is ImportJob => job?.data.requesterId === userId)
    .sort(
      (left, right) =>
        right.timestamp - left.timestamp ||
        (right.id ?? '').localeCompare(left.id ?? ''),
    );
}
