import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getQueueToken } from '@nestjs/bullmq';
import { REDIS } from '@libs/common';
import { newId, toUuid } from '@libs/database';
import {
  PROBLEM_DATABYTES_JOB_ID,
  PROBLEM_DATABYTES_QUEUE,
  ProblemDataFilesService,
  QUOTA_BACKFILL_DONE_KEY,
} from '@libs/problems';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { ProblemDataBytesProcessor } from '../src/jobs/problem-databytes/problem-databytes.processor';
import { ProblemDataBytesRepository } from '../src/jobs/problem-databytes/problem-databytes.repository';
import { ProblemDataBytesService } from '../src/jobs/problem-databytes/problem-databytes.service';
import { setupWorkerTest } from './setup';
import type { WorkerTest } from './setup';

describe('problem dataBytes backfill', () => {
  let worker: WorkerTest;
  let service: ProblemDataBytesService;
  let counter = 0;
  const seed = async (
    bytes: number | null,
    extra: Record<string, unknown> = {},
  ) => {
    counter += 1;
    const code = `bf${counter}`;
    if (bytes !== null) {
      mkdirSync(join(worker.problemDataRoot, code), { recursive: true });
      writeFileSync(
        join(worker.problemDataRoot, code, 'tests.zip'),
        Buffer.alloc(bytes),
      );
    }
    // Straight into the collection: some rows need a code the schema would refuse, and `_id` must be a BSON UUID like the real ones.
    await worker.problems.collection.insertOne({
      _id: toUuid(newId()),
      code,
      name: code,
      timeLimit: 1,
      memoryLimit: 1024,
      points: 1,
      dataBytes: 999,
      ...extra,
    } as never);
    return code;
  };
  const stored = async (code: string) =>
    (await worker.problems.findOne({ code }, { dataBytes: 1 }).lean())
      ?.dataBytes;
  const redis = () => worker.module.get<Redis>(REDIS);

  beforeAll(async () => {
    worker = await setupWorkerTest();
    service = worker.module.get(ProblemDataBytesService);
  });
  beforeEach(() => redis().del(QUOTA_BACKFILL_DONE_KEY));
  afterAll(() => worker.teardown());

  it('sets every problem to the bytes on disk and zero when the directory is gone', async () => {
    const full = await seed(1500);
    const gone = await seed(null);
    await service.backfill();
    expect(await stored(full)).toBe(1500);
    expect(await stored(gone)).toBe(0);
  });

  it('fills a problem that has no dataBytes yet', async () => {
    const legacy = await seed(40, { dataBytes: undefined });
    await service.backfill();
    expect(await stored(legacy)).toBe(40);
  });

  it('is idempotent and reports what it measured', async () => {
    await seed(10);
    await service.backfill();
    const second = await service.backfill();
    expect(second.problems).toBeGreaterThanOrEqual(1);
    expect(second.bytes).toBeGreaterThanOrEqual(10);
  });

  it('measures a problem whose stored code is not a valid directory name as zero instead of failing', async () => {
    await seed(null, { code: 'Bad Code!' });
    await expect(service.backfill()).resolves.toBeDefined();
    expect(await stored('Bad Code!')).toBe(0);
  });

  it('keeps the value a data write recorded while the problem was being measured', async () => {
    const code = await seed(100);
    const files = worker.module.get(ProblemDataFilesService);
    const real = files.bytesOf.bind(files);
    const measuring = jest
      .spyOn(files, 'bytesOf')
      .mockImplementation(async (target) => {
        const size = await real(target);
        if (target === code)
          await worker.problems.updateOne({ code }, { dataBytes: 777 });
        return size;
      });
    await service.backfill();
    measuring.mockRestore();
    expect(await stored(code)).toBe(777);
  });

  it('marks the backfill done only when every problem was measured', async () => {
    await service.backfill();
    expect(await redis().get(QUOTA_BACKFILL_DONE_KEY)).toBe('1');
    await redis().del(QUOTA_BACKFILL_DONE_KEY);
    const failing = jest
      .spyOn(worker.module.get(ProblemDataBytesRepository), 'setSizes')
      .mockRejectedValueOnce(new Error('mongo down'));
    await seed(5);
    await expect(service.backfill()).rejects.toThrow('mongo down');
    failing.mockRestore();
    expect(await redis().get(QUOTA_BACKFILL_DONE_KEY)).toBeNull();
  });

  it('is queued once under a fixed job id, however often it is added', async () => {
    const queue = worker.module.get<Queue>(
      getQueueToken(PROBLEM_DATABYTES_QUEUE),
    );
    const processor = worker.module.get(ProblemDataBytesProcessor);
    await queue.obliterate({ force: true });
    await processor.onApplicationBootstrap();
    await processor.onApplicationBootstrap();
    const jobs = await queue.getJobs([
      'waiting',
      'active',
      'completed',
      'delayed',
      'failed',
    ]);
    expect(jobs.map((job) => job.id)).toEqual([PROBLEM_DATABYTES_JOB_ID]);
  });
});
