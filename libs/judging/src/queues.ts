import type { Queue } from 'bullmq';
import { uuidStr } from '@libs/database';

const FAILED_JOB_RETENTION_SECONDS = 7 * 24 * 60 * 60;
/** Finished jobs are dropped at once; failed ones stay a week for inspection. */
export const JOB_RETENTION = {
  removeOnComplete: true,
  removeOnFail: { age: FAILED_JOB_RETENTION_SECONDS },
};
/** First retry delay of the queue's jobs; BullMQ doubles it per attempt. */
const RETRY_BACKOFF_MS = 10_000;
/** Effects are idempotent recomputes: three tries, 10 s then 20 s apart (BullMQ doubles the delay). */
export const JOB_RETRY = {
  attempts: 3,
  backoff: { type: 'exponential', delay: RETRY_BACKOFF_MS },
};

export const SUBMISSION_GRADED_QUEUE = 'submission-graded';
export const SUBMISSION_GRADED_JOB = 'graded';

/** One per finished submission (D, CE, IE, AB) and per reject; 2b recomputes the user's points, the problem's stats and the solved sets from it. */
export interface SubmissionGradedJob {
  submissionId: string;
  userId: string;
  problemId: string;
}

/** From a lean (BSON UUID) or hydrated (string) submission row. */
export const gradedJobOf = (submission: {
  _id: unknown;
  user: unknown;
  problem: unknown;
}): SubmissionGradedJob => ({
  submissionId: uuidStr(submission._id),
  userId: uuidStr(submission.user),
  problemId: uuidStr(submission.problem),
});

/** Shared by the bridge and the api so every producer uses the same job name, retention and retry policy (effects are idempotent recomputes, so a transient failure is retried). The api passes no `jobId`. The bridge passes `gradedJobId(submissionId, generation)`: a Final resent before its ack enqueues the same id, which BullMQ drops while the first job still waits, and a rejudge is a new generation, so it is never dropped as a duplicate of the run it replaced. A job lost outright (the process died before `add` reached Redis) is repaired by the worker's effects sweep from the row's `effectsDueAt`. */
export const enqueueGraded = async (
  queue: Queue<SubmissionGradedJob>,
  job: SubmissionGradedJob,
  jobId?: string,
): Promise<void> => {
  await queue.add(SUBMISSION_GRADED_JOB, job, {
    ...JOB_RETRY,
    ...JOB_RETENTION,
    ...(jobId && { jobId }),
  });
};

/** One job id per judge run; BullMQ refuses `:` in custom ids. */
export const gradedJobId = (submissionId: string, generation: number) =>
  `${submissionId}.${generation}`;

export const PROBLEM_RESCORE_QUEUE = 'problem-rescore';
export const PROBLEM_RESCORE_JOB = 'rescore';
/** Recompute `points` of every graded submission of the problem, then its users and stats. Enqueued by the api on `pointsChanged`/`publicityChanged` and by the worker after a Polygon re-import. */
export interface ProblemRescoreJob {
  problemId: string;
}
/** No `jobId`: an edit while a rescore of the same problem runs must queue another one (BullMQ ignores an `add` whose id is active). The queue runs one job at a time, oldest first, so the last edit wins; retried because every step is idempotent. */
export const enqueueRescore = async (
  queue: Queue<ProblemRescoreJob>,
  problemId: string,
): Promise<void> => {
  await queue.add(
    PROBLEM_RESCORE_JOB,
    { problemId },
    {
      ...JOB_RETRY,
      ...JOB_RETENTION,
    },
  );
};

/** `enqueueRescore` for many problems in one round trip (an admin bulk rescore). */
export const enqueueRescores = async (
  queue: Queue<ProblemRescoreJob>,
  problemIds: readonly string[],
): Promise<void> => {
  await queue.addBulk(
    problemIds.map((problemId) => ({
      name: PROBLEM_RESCORE_JOB,
      data: { problemId },
      opts: { ...JOB_RETRY, ...JOB_RETENTION },
    })),
  );
};

/** Worker-internal: the scheduled sweep that recomputes what lost graded jobs left stale. */
export const EFFECTS_SWEEP_QUEUE = 'effects-sweep';
export const EFFECTS_SWEEP_JOB = 'sweep';
export const EFFECTS_SWEEP_SCHEDULER = 'effects-sweep-every-10-minutes';

export const SIMILARITY_QUEUE = 'similarity';
export const SIMILARITY_JOB = 'compare';
/** Only the run id travels: the run document holds the scope and the limits the api snapshotted. */
export interface SimilarityJob {
  runId: string;
}
export const similarityJobId = (runId: string) => `similarity-${runId}`;
/** The worker's budget for one run, all its groups. The queue runs one job at a time, so this also bounds the wait of the next scope; the api treats a run still running past it (plus a margin) as abandoned. */
export const SIMILARITY_DEADLINE_MS = 30 * 60 * 1000;
/** One attempt: a failed run is recorded as failed and the staff member starts another; a retry would compare the same sources again for the same failure. */
export const enqueueSimilarity = async (
  queue: Queue<SimilarityJob>,
  runId: string,
): Promise<void> => {
  await queue.add(
    SIMILARITY_JOB,
    { runId },
    { jobId: similarityJobId(runId), attempts: 1, ...JOB_RETENTION },
  );
};
