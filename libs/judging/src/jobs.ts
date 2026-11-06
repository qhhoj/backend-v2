import {
  defineJob,
  JOB_RETENTION,
  JOB_RETRY,
  MINUTE_MS,
  SCHEDULED_RETENTION,
} from '@libs/common';
import { OrganizationJudgingCharge, Submission, uuidStr } from '@libs/database';

/** One per finished submission (D, CE, IE, AB) and per reject; the submission-effects job recomputes the user's points, the problem's stats and the solved sets from it. */
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

/** The bridge's job id, one per judge run: a Final resent before its ack enqueues the same id, which BullMQ drops while the first job still waits, and a rejudge is a new generation, so it is never dropped as a duplicate of the run it replaced. BullMQ refuses `:` in custom ids. */
export const gradedJobId = (submissionId: string, generation: number) =>
  `${submissionId}.${generation}`;

/** Recompute `points` of every graded submission of the problem, then its users and stats. Enqueued by the api on `pointsChanged`/`publicityChanged` and by the worker after a Polygon re-import or a contest publish. */
export interface ProblemRescoreJob {
  problemId: string;
}

/** Only the run id travels: the run document holds the scope and the limits the api snapshotted. */
export interface SimilarityJob {
  runId: string;
}
/** The worker's budget for one run, all its groups. The queue runs one job at a time, so this also bounds the wait of the next scope; the api treats a run still running past it (plus a margin) as abandoned. */
export const SIMILARITY_DEADLINE_MS = 30 * MINUTE_MS;

/** How often the effects sweep runs. */
export const SWEEP_INTERVAL_MS = 10 * MINUTE_MS;

export const judgingJobs = {
  /**
   * Retried: effects are idempotent recomputes. The api passes no job id; the bridge passes `gradedJobId`. A job lost outright (the process died before `add` reached Redis) is repaired by the effects sweep from the row's `effectsDueAt`.
   * The stats count is hinted to a submissions index; the judging charge is made idempotent by its unique index.
   */
  graded: defineJob<SubmissionGradedJob>({
    queue: 'submission-graded',
    name: 'graded',
    options: { ...JOB_RETRY, ...JOB_RETENTION },
    describe: ({ submissionId }) => `Graded job of submission ${submissionId}`,
    concurrency: 4,
    needsIndexes: [Submission, OrganizationJudgingCharge],
  }),
  /** No job id: an edit while a rescore of the same problem runs must queue another (BullMQ ignores an `add` whose id is active). One at a time, oldest first, so the last edit wins: two interleaved rescores of one problem could write the older points last. */
  problemRescore: defineJob<ProblemRescoreJob>({
    queue: 'problem-rescore',
    name: 'rescore',
    options: { ...JOB_RETRY, ...JOB_RETENTION },
    describe: ({ problemId }) => `Rescore of problem ${problemId}`,
    oneAtATime: true,
    needsIndexes: [Submission],
  }),
  /**
   * Repairs what lost graded jobs left stale. BullMQ adds the next run when the current one starts, so a slow sweep would overlap it on another process; one at a time makes the next one wait.
   * BullMQ queues a first sweep when the schedule is created or its slot has passed, so a first boot or a restart after a missed slot sweeps at once; a warm restart within the interval does not.
   * The window reads are index-bound; a repair charges judging time, which relies on the charges' unique index.
   */
  effectsSweep: defineJob<void>({
    queue: 'effects-sweep',
    name: 'sweep',
    options: SCHEDULED_RETENTION,
    describe: () => 'Effects sweep',
    oneAtATime: true,
    schedule: {
      id: 'effects-sweep-every-10-minutes',
      repeat: { every: SWEEP_INTERVAL_MS },
    },
    needsIndexes: [Submission, OrganizationJudgingCharge],
  }),
  /** One attempt: a failed run is recorded as failed and the staff member starts another; a retry would compare the same sources again for the same failure. One run at a time across worker processes: each spawns an engine child of up to 2 GiB. */
  similarity: defineJob<SimilarityJob>({
    queue: 'similarity',
    name: 'compare',
    options: { attempts: 1, ...JOB_RETENTION },
    jobId: ({ runId }) => `similarity-${runId}`,
    describe: ({ runId }) => `Similarity run ${runId}`,
    oneAtATime: true,
    needsIndexes: [Submission],
  }),
};
