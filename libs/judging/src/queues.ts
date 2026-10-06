import type { Queue } from 'bullmq';
import { uuidStr } from '@libs/database';

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

/** Shared by the bridge and the api so every producer uses the same job name and retention. */
export const enqueueGraded = async (
  queue: Queue<SubmissionGradedJob>,
  job: SubmissionGradedJob,
): Promise<void> => {
  await queue.add(SUBMISSION_GRADED_JOB, job, {
    removeOnComplete: true,
    removeOnFail: { age: 7 * 24 * 60 * 60 },
  });
};
