import { Queue } from 'bullmq';
import { MongoClient } from 'mongodb';
import type { UUID } from 'mongodb';
import { TEST_REDIS_URL, waitUntil } from '@libs/common/testing';
import { newId, toUuid } from '@libs/database';
import { enqueueGraded, SUBMISSION_GRADED_QUEUE } from '@libs/judging';
import type { SubmissionGradedJob } from '@libs/judging';
import { setupWorkerTest } from './setup';
import type { WorkerTest } from './setup';

describe('submission effects at boot', () => {
  let worker: WorkerTest;
  const problemId = newId();
  const userId = newId();

  /** A fresh deployment: rows exist, the submissions indexes do not, and a graded job is already queued. */
  const seedBeforeBoot = async (mongoUri: string) => {
    const client = await MongoClient.connect(mongoUri);
    const submissionId = newId();
    await client
      .db()
      .collection<{ _id: UUID } & Record<string, unknown>>('problems')
      .insertOne({
        _id: toUuid(problemId),
        points: 1000,
        isPublic: true,
        isOrganizationPrivate: false,
        userCount: 0,
        acRate: 0,
      });
    await client
      .db()
      .collection<{ _id: UUID } & Record<string, unknown>>('submissions')
      .insertOne({
        _id: toUuid(submissionId),
        user: toUuid(userId),
        problem: toUuid(problemId),
        status: 'D',
        result: 'AC',
        points: 1000,
        casePoints: 1,
        caseTotal: 1,
      });
    await client.close();
    const queue = new Queue<SubmissionGradedJob>(SUBMISSION_GRADED_QUEUE, {
      connection: { url: TEST_REDIS_URL },
    });
    await enqueueGraded(queue, { submissionId, userId, problemId });
    await queue.close();
  };

  beforeAll(async () => {
    worker = await setupWorkerTest({ seedBeforeBoot });
  });
  afterAll(() => worker.teardown());

  it('processes a job queued before boot once the indexes exist, without a failed attempt', async () => {
    await waitUntil(
      async () =>
        (await worker.problems.findById(problemId, { userCount: 1 }).lean())
          ?.userCount === 1,
    );
    const queue = new Queue(SUBMISSION_GRADED_QUEUE, {
      connection: { url: TEST_REDIS_URL },
    });
    // waitUntil's 5 s is shorter than the 10 s first backoff: a failed first attempt would still sit in `delayed`.
    expect(await queue.getJobCounts('failed', 'delayed')).toEqual({
      failed: 0,
      delayed: 0,
    });
    await queue.close();
  });
});
