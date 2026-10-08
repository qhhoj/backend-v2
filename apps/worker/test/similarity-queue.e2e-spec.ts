import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { waitUntil } from '@libs/common/testing';
import { newId, uuidStr } from '@libs/database';
import { enqueueSimilarity, SIMILARITY_QUEUE } from '@libs/judging';
import type { SimilarityJob } from '@libs/judging';
import { seedGraded, seedProblem, seedUser } from './effects-fixtures';
import { SIEVE, SIEVE_RENAMED } from './similarity-fixtures';
import { setupWorkerTest } from './setup';
import type { WorkerTest } from './setup';

jest.setTimeout(60_000);

describe('similarity queue', () => {
  let worker: WorkerTest;
  const queueOf = () =>
    worker.module.get<Queue<SimilarityJob>>(getQueueToken(SIMILARITY_QUEUE));
  beforeAll(async () => {
    worker = await setupWorkerTest();
  });
  afterAll(() => worker.teardown());

  it('consumes an enqueued run and finishes it', async () => {
    const problem = await seedProblem(worker);
    const language = await worker.languages.create({
      key: 'CPP17',
      name: 'C++17',
      commonName: 'C++',
      ace: 'text',
      pygments: 'text',
      extension: 'cpp',
    });
    for (const source of [SIEVE, SIEVE_RENAMED]) {
      const submission = await seedGraded(
        worker,
        (await seedUser(worker))._id,
        problem._id,
        { language: language._id },
      );
      await worker.submissionSources.create({ _id: submission._id, source });
    }
    const run = await worker.similarityRuns.create({
      scope: 'problem',
      scopeKey: `problem:${problem._id}`,
      problem: problem._id,
      requestedBy: newId(),
      limits: { minPercent: 50, maxPairs: 2000, maxSubmissions: 3000 },
    });
    await enqueueSimilarity(queueOf(), run._id);
    await waitUntil(
      async () =>
        (await worker.similarityRuns.findById(run._id))?.status === 'done',
    );
    expect(await worker.similarityPairs.countDocuments({ run: run._id })).toBe(
      1,
    );
  });

  it('a second enqueue for the same run adds no job', async () => {
    const runId = uuidStr(newId());
    await enqueueSimilarity(queueOf(), runId);
    await enqueueSimilarity(queueOf(), runId);
    const jobs = await queueOf().getJobs([
      'waiting',
      'active',
      'completed',
      'failed',
    ]);
    expect(jobs.filter((job) => job.data.runId === runId)).toHaveLength(1);
  });
});
