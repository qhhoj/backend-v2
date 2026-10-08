import { Queue } from 'bullmq';
import { TEST_REDIS_URL } from '@libs/common/testing';
import { newId } from '@libs/database';
import { Binary } from 'mongodb';
import {
  PROBLEM_RESCORE_QUEUE,
  SUBMISSION_GRADED_QUEUE,
  enqueueGraded,
  enqueueRescore,
  gradedJobOf,
} from './queues';
import type { ProblemRescoreJob, SubmissionGradedJob } from './queues';

const uuidBinary = (id: string): Binary =>
  new Binary(Buffer.from(id.replaceAll('-', ''), 'hex'), Binary.SUBTYPE_UUID);

describe('gradedJobOf', () => {
  it('reads string ids from a hydrated row', () => {
    const [submissionId, userId, problemId] = [newId(), newId(), newId()];
    expect(
      gradedJobOf({ _id: submissionId, user: userId, problem: problemId }),
    ).toEqual({ submissionId, userId, problemId });
  });
  it('reads string ids from a lean row holding BSON UUIDs', () => {
    const [submissionId, userId, problemId] = [newId(), newId(), newId()];
    expect(
      gradedJobOf({
        _id: uuidBinary(submissionId),
        user: uuidBinary(userId),
        problem: uuidBinary(problemId),
      }),
    ).toEqual({ submissionId, userId, problemId });
  });
});

describe('retried judging jobs', () => {
  const queues = {
    graded: new Queue<SubmissionGradedJob>(SUBMISSION_GRADED_QUEUE, {
      connection: { url: TEST_REDIS_URL },
    }),
    rescore: new Queue<ProblemRescoreJob>(PROBLEM_RESCORE_QUEUE, {
      connection: { url: TEST_REDIS_URL },
    }),
  };
  beforeAll(async () => {
    await Promise.all(
      Object.values(queues).map((queue) => queue.obliterate({ force: true })),
    );
  });
  afterAll(async () => {
    await Promise.all(
      Object.values(queues).map(async (queue) => {
        await queue.obliterate({ force: true });
        await queue.close();
      }),
    );
  });

  it('queues graded and rescore jobs with three attempts and a 10 s exponential backoff', async () => {
    await enqueueGraded(queues.graded, {
      submissionId: newId(),
      userId: newId(),
      problemId: newId(),
    });
    await enqueueRescore(queues.rescore, newId());
    const [graded] = await queues.graded.getJobs(['waiting']);
    const [rescore] = await queues.rescore.getJobs(['waiting']);
    for (const job of [graded, rescore]) {
      expect(job.opts).toMatchObject({
        attempts: 3,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: true,
      });
    }
  });
});
