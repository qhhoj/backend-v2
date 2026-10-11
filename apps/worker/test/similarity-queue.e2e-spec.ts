import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { waitUntil } from '@libs/common/testing';
import { newId, uuidStr } from '@libs/database';
import { enqueueSimilarity, SIMILARITY_QUEUE } from '@libs/judging';
import type { SimilarityRun } from '@libs/database';
import type { SimilarityJob } from '@libs/judging';
import { SimilarityProcessor } from '../src/jobs/similarity/similarity.processor';
import { seedGraded, seedProblem, seedUser } from './effects-fixtures';
import { SIEVE, SIEVE_RENAMED } from './similarity-fixtures';
import { setupWorkerTest } from './setup';
import type { WorkerTest } from './setup';

describe('similarity queue', () => {
  let worker: WorkerTest;
  const queueOf = () =>
    worker.module.get<Queue<SimilarityJob>>(getQueueToken(SIMILARITY_QUEUE));
  beforeAll(async () => {
    worker = await setupWorkerTest();
  });
  afterAll(() => worker.teardown());

  const createRun = async (status: 'queued' | 'running' = 'queued') => {
    const problem = await seedProblem(worker);
    return worker.similarityRuns.create({
      scope: 'problem',
      scopeKey: `problem:${problem._id}`,
      problem: problem._id,
      requestedBy: newId(),
      status,
      limits: { minPercent: 50, maxPairs: 2000, maxSubmissions: 3000 },
    });
  };

  /** Two renamed copies of one solution in the run's problem. */
  const seedCopies = async (run: SimilarityRun) => {
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
        run.problem!,
        { language: language._id },
      );
      await worker.submissionSources.create({ _id: submission._id, source });
    }
  };

  it('consumes an enqueued run and finishes it', async () => {
    const run = await createRun();
    await seedCopies(run);
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
    const queue = queueOf();
    // Paused, so the live worker cannot finish (and, with removeOnComplete, free) the jobId between the two adds.
    await queue.pause();
    try {
      await enqueueSimilarity(queue, runId);
      await enqueueSimilarity(queue, runId);
      expect(await queue.getJobCounts('waiting', 'paused')).toEqual(
        expect.objectContaining({ waiting: 0, paused: 1 }),
      );
    } finally {
      await queue.resume();
    }
  });

  it('a job that fails outside run (stalled out) fails its run', async () => {
    const run = await createRun('running');
    const { worker: queueWorker } = worker.module.get(SimilarityProcessor);
    const job = { id: 'stalled', data: { runId: uuidStr(run._id) } };
    queueWorker.emit(
      'failed',
      job as never,
      new Error('job stalled'),
      'active',
    );
    await waitUntil(
      async () =>
        (await worker.similarityRuns.findById(run._id))?.status === 'failed',
    );
    expect((await worker.similarityRuns.findById(run._id))?.error).toBe(
      'internal_error',
    );
  });
});
