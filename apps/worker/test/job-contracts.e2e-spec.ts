import { Queue } from 'bullmq';
import { MongoClient } from 'mongodb';
import type { UUID } from 'mongodb';
import { TEST_REDIS_URL, waitUntil } from '@libs/common/testing';
import { newId, toUuid } from '@libs/database';
import { judgingJobs } from '@libs/judging';
import mainJobs from './job-contracts/main-jobs.json';
import { setupWorkerTest } from './setup';
import type { WorkerTest } from './setup';

/** Jobs written by the release before this one (captured from its producers) and still in Redis at the restart: the new consumers run them. */
describe('jobs queued by the previous release', () => {
  const { ids, jobs } = mainJobs;
  const queued = (queue: string) => jobs.filter((job) => job.queue === queue);
  const otherSubmission = newId();
  let worker: WorkerTest;

  const addAsCaptured = async (captured: (typeof jobs)[number]) => {
    const queue = new Queue(captured.queue, {
      connection: { url: TEST_REDIS_URL },
    });
    await queue.add(captured.name, captured.data, captured.opts);
    await queue.close();
  };

  /** Graded and rescore jobs wait before boot, with no submissions indexes yet. */
  const seedBeforeBoot = async (mongoUri: string) => {
    const client = await MongoClient.connect(mongoUri);
    const database = client.db();
    const problems = database.collection<
      { _id: UUID } & Record<string, unknown>
    >('problems');
    for (const [code, problemId] of Object.entries({
      graded: ids.problem,
      other: ids.otherProblem,
    }))
      await problems.insertOne({
        _id: toUuid(problemId),
        code,
        points: 1000,
        partial: true,
        isPublic: true,
        isOrganizationPrivate: false,
        userCount: 0,
        acRate: 0,
      });
    const submission = (problemId: string, casePoints: number) => ({
      user: toUuid(ids.user),
      problem: toUuid(problemId),
      status: 'D',
      result: casePoints === 1 ? 'AC' : 'WA',
      points: 0,
      casePoints,
      caseTotal: 1,
    });
    await database
      .collection<{ _id: UUID } & Record<string, unknown>>('submissions')
      .insertMany([
        {
          _id: toUuid(ids.submission),
          ...submission(ids.problem, 1),
          effectsDueAt: new Date(),
        },
        { _id: toUuid(otherSubmission), ...submission(ids.otherProblem, 0.5) },
      ]);
    await client.close();
    for (const job of [
      ...queued(judgingJobs.graded.queue),
      ...queued(judgingJobs.problemRescore.queue),
    ])
      await addAsCaptured(job);
  };

  beforeAll(async () => {
    worker = await setupWorkerTest({ seedBeforeBoot });
  });
  afterAll(() => worker.teardown());

  /** Completed jobs are removed at once (`JOB_RETENTION`), so a settled queue counts nothing; a retry would sit in `delayed` past waitUntil's 5 s. */
  const jobCount = async (queueName: string) => {
    const queue = new Queue(queueName, { connection: { url: TEST_REDIS_URL } });
    const counts = await queue.getJobCounts(
      'waiting',
      'active',
      'delayed',
      'failed',
    );
    await queue.close();
    return Object.values(counts).reduce((sum, count) => sum + count, 0);
  };

  it('applies the graded jobs of the api and the bridge, and rescores both problems', async () => {
    await waitUntil(async () => {
      const [graded, rescored, other] = await Promise.all([
        worker.problems.findById(ids.problem, { userCount: 1 }).lean(),
        worker.submissions
          .findById(ids.submission, { points: 1, effectsDueAt: 1 })
          .lean(),
        worker.submissions.findById(otherSubmission, { points: 1 }).lean(),
      ]);
      return (
        graded?.userCount === 1 &&
        rescored?.points === 1000 &&
        rescored.effectsDueAt === null &&
        other?.points === 500 &&
        (await jobCount(judgingJobs.graded.queue)) === 0 &&
        (await jobCount(judgingJobs.problemRescore.queue)) === 0
      );
    });
  });

  it('runs the similarity job of the api', async () => {
    await worker.similarityRuns.create({
      _id: ids.run,
      scope: 'problem',
      scopeKey: `problem:${ids.problem}`,
      problem: ids.problem,
      requestedBy: ids.user,
      status: 'queued',
      limits: { minPercent: 50, maxPairs: 2000, maxSubmissions: 3000 },
    });
    for (const job of queued(judgingJobs.similarity.queue))
      await addAsCaptured(job);
    await waitUntil(
      async () =>
        (await worker.similarityRuns.findById(ids.run, { status: 1 }).lean())
          ?.status === 'done',
    );
  });
});
