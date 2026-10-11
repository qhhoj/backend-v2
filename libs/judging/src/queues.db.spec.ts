import { Queue } from 'bullmq';
import { TEST_REDIS_URL } from '@libs/common/testing';
import { newId } from '@libs/database';
import { Binary } from 'mongodb';
import {
  SUBMISSION_GRADED_QUEUE,
  enqueueGraded,
  gradedJobId,
  gradedJobOf,
} from './queues';
import type { SubmissionGradedJob } from './queues';

const uuidBinary = (id: string): Binary =>
  new Binary(Buffer.from(id.replaceAll('-', ''), 'hex'), Binary.SUBTYPE_UUID);

describe('gradedJobOf', () => {
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

  it('drops a second graded job of the same run while the first waits, and keeps another run', async () => {
    await queues.graded.obliterate({ force: true });
    const job = { submissionId: newId(), userId: newId(), problemId: newId() };
    const firstRun = gradedJobId(job.submissionId, 1);
    await enqueueGraded(queues.graded, job, firstRun);
    await enqueueGraded(queues.graded, job, firstRun);
    await enqueueGraded(queues.graded, job, gradedJobId(job.submissionId, 2));
    const waiting = await queues.graded.getJobs(['waiting']);
    expect(waiting.map((queued) => queued.id).sort()).toEqual([
      `${job.submissionId}.1`,
      `${job.submissionId}.2`,
    ]);
  });
});
