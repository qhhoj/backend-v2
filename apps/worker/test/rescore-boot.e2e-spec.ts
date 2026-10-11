import { Queue } from 'bullmq';
import { MongoClient } from 'mongodb';
import type { UUID } from 'mongodb';
import { TEST_REDIS_URL, waitUntil } from '@libs/common/testing';
import { newId, toUuid } from '@libs/database';
import { enqueueRescore, PROBLEM_RESCORE_QUEUE } from '@libs/judging';
import type { ProblemRescoreJob } from '@libs/judging';
import { setupWorkerTest } from './setup';
import type { WorkerTest } from './setup';

describe('problem rescore at boot', () => {
  let worker: WorkerTest;
  const problemId = newId();
  const userId = newId();
  const submissionId = newId();

  /** A fresh deployment: rows exist, the submissions indexes do not, and a rescore is already queued. */
  const seedBeforeBoot = async (mongoUri: string) => {
    const client = await MongoClient.connect(mongoUri);
    const database = client.db();
    await database
      .collection<{ _id: UUID } & Record<string, unknown>>('problems')
      .insertOne({
        _id: toUuid(problemId),
        points: 1000,
        partial: true,
        isPublic: true,
        isOrganizationPrivate: false,
        userCount: 0,
        acRate: 0,
      });
    await database
      .collection<{ _id: UUID } & Record<string, unknown>>('submissions')
      .insertOne({
        _id: toUuid(submissionId),
        user: toUuid(userId),
        problem: toUuid(problemId),
        status: 'D',
        result: 'WA',
        points: 100,
        casePoints: 1,
        caseTotal: 2,
      });
    await client.close();
    const queue = new Queue<ProblemRescoreJob>(PROBLEM_RESCORE_QUEUE, {
      connection: { url: TEST_REDIS_URL },
    });
    await enqueueRescore(queue, problemId);
    await queue.close();
  };

  beforeAll(async () => {
    worker = await setupWorkerTest({ seedBeforeBoot });
  });
  afterAll(() => worker.teardown());

  it('rescores a job queued before boot once the indexes exist, without a failed attempt', async () => {
    await waitUntil(
      async () =>
        (await worker.submissions.findById(submissionId, { points: 1 }).lean())
          ?.points === 500,
    );
    const queue = new Queue(PROBLEM_RESCORE_QUEUE, {
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
