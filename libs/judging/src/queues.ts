import type { Queue } from 'bullmq';
import { uuidStr } from '@libs/database';

/** Finished jobs are dropped at once; failed ones stay a week for inspection. */
export const JOB_RETENTION = {
  removeOnComplete: true,
  removeOnFail: { age: 7 * 24 * 60 * 60 },
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

/** Shared by the bridge and the api so every producer uses the same job name, retention and retry policy (effects are idempotent recomputes, so a transient failure is retried). No deterministic `jobId` on purpose: BullMQ would drop the job of a rejudge finishing while the previous one is still active, leaving stale stats. */
export const enqueueGraded = async (
  queue: Queue<SubmissionGradedJob>,
  job: SubmissionGradedJob,
): Promise<void> => {
  await queue.add(SUBMISSION_GRADED_JOB, job, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 10_000 },
    ...JOB_RETENTION,
  });
};

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
      attempts: 3,
      backoff: { type: 'exponential', delay: 10_000 },
      ...JOB_RETENTION,
    },
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
