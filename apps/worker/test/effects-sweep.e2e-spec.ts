import { getQueueToken } from '@nestjs/bullmq';
import { Worker } from 'bullmq';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { REDIS } from '@libs/common';
import { TEST_REDIS_URL, waitUntil } from '@libs/common/testing';
import { newId } from '@libs/database';
import { profileQueries } from '@libs/database/testing';
import { EFFECTS_SWEEP_JOB, EFFECTS_SWEEP_QUEUE } from '@libs/judging';
import { EffectsSweepProcessor } from '../src/jobs/effects-sweep/effects-sweep.processor';
import {
  EffectsSweepService,
  SWEEP_WATERMARK_KEY,
} from '../src/jobs/effects-sweep/effects-sweep.service';
import { SubmissionEffectsService } from '../src/jobs/submission-effects/submission-effects.service';
import {
  insertGradedRows,
  seedGraded,
  seedProblem,
  seedUser,
} from './effects-fixtures';
import { setupWorkerTest } from './setup';
import type { WorkerTest } from './setup';

const MINUTE = 60_000;
const sleep = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

describe('effects sweep', () => {
  let worker: WorkerTest;
  let sweeps: EffectsSweepService;
  let redis: Redis;
  let queue: Queue;
  const pointsOf = async (userId: string) =>
    (await worker.users.findById(userId, { points: 1 }).lean())!.points;
  const statsOf = async (problemId: string) =>
    (await worker.problems
      .findById(problemId, { userCount: 1, acRate: 1 })
      .lean())!;

  const sweepQueueIdle = () =>
    waitUntil(async () => {
      const { active, waiting } = await queue.getJobCounts('active', 'waiting');
      return active + waiting === 0;
    });

  beforeAll(async () => {
    worker = await setupWorkerTest();
    sweeps = worker.module.get(EffectsSweepService);
    redis = worker.module.get<Redis>(REDIS);
    queue = worker.module.get<Queue>(getQueueToken(EFFECTS_SWEEP_QUEUE));
  });
  afterAll(() => worker.teardown());

  it('keeps one 10-minute schedule however many worker processes boot', async () => {
    const processor = worker.module.get(EffectsSweepProcessor);
    await processor.onApplicationBootstrap();
    await processor.onApplicationBootstrap();
    await sweepQueueIdle();
    const schedulers = await queue.getJobSchedulers();
    expect(schedulers).toHaveLength(1);
    expect(schedulers[0]).toMatchObject({ every: 10 * MINUTE });
  });

  it('recovers users and problems whose graded job was lost, compile errors included', async () => {
    const solver = await seedUser(worker);
    const solvedProblem = await seedProblem(worker);
    await seedGraded(worker, solver._id, solvedProblem._id);
    const compiler = await seedUser(worker, { points: 77 });
    const compiledProblem = await seedProblem(worker, { acRate: 50 });
    await seedGraded(worker, compiler._id, compiledProblem._id, {
      status: 'CE',
      result: 'CE',
      points: null,
      casePoints: 0,
      caseTotal: 0,
      judgedDate: null,
    });
    const old = new Date(Date.now() - 3 * 60 * MINUTE);
    const untouched = await seedUser(worker, { points: 55 });
    await seedGraded(worker, untouched._id, (await seedProblem(worker))._id, {
      date: old,
      judgedDate: old,
    });
    await redis.set(SWEEP_WATERMARK_KEY, String(Date.now() - MINUTE));
    const started = Date.now();
    await sweeps.sweep();
    expect(await pointsOf(solver._id)).toBe(1000);
    expect(await statsOf(solvedProblem._id)).toMatchObject({
      userCount: 1,
      acRate: 100,
    });
    expect(await pointsOf(compiler._id)).toBe(0);
    expect((await statsOf(compiledProblem._id)).acRate).toBe(0);
    expect(await pointsOf(untouched._id)).toBe(55);
    expect(Number(await redis.get(SWEEP_WATERMARK_KEY))).toBeGreaterThanOrEqual(
      started,
    );
  });

  it('starts from the last sweep less one overlap, so a grading that began earlier is still covered', async () => {
    const now = Date.now();
    await redis.set(SWEEP_WATERMARK_KEY, String(now - 60 * MINUTE));
    const covered = await seedUser(worker, { points: 1 });
    const outside = await seedUser(worker, { points: 1 });
    const problem = await seedProblem(worker);
    const at = (minutesAgo: number) => new Date(now - minutesAgo * MINUTE);
    await seedGraded(worker, covered._id, problem._id, {
      date: at(65),
      judgedDate: at(65),
    });
    await seedGraded(worker, outside._id, problem._id, {
      date: at(75),
      judgedDate: at(75),
    });
    await sweeps.sweep(now);
    expect(await pointsOf(covered._id)).toBe(1000);
    expect(await pointsOf(outside._id)).toBe(1);
  });

  it('looks back at most a day after a long gap', async () => {
    const now = Date.now();
    await redis.set(SWEEP_WATERMARK_KEY, String(now - 48 * 60 * MINUTE));
    const recent = await seedUser(worker, { points: 1 });
    const stale = await seedUser(worker, { points: 1 });
    const problem = await seedProblem(worker);
    const at = (hoursAgo: number) => new Date(now - hoursAgo * 60 * MINUTE);
    await seedGraded(worker, recent._id, problem._id, {
      date: at(12),
      judgedDate: at(12),
    });
    await seedGraded(worker, stale._id, problem._id, {
      date: at(30),
      judgedDate: at(30),
    });
    await sweeps.sweep(now);
    expect(await pointsOf(recent._id)).toBe(1000);
    expect(await pointsOf(stale._id)).toBe(1);
  });

  it('keeps the window when a recompute fails, so the next sweep covers it again', async () => {
    const user = await seedUser(worker, { points: 1 });
    await seedGraded(worker, user._id, (await seedProblem(worker))._id);
    const now = Date.now();
    const before = String(now - 30 * MINUTE);
    await redis.set(SWEEP_WATERMARK_KEY, before);
    const effects = worker.module.get(SubmissionEffectsService);
    const failing = jest
      .spyOn(effects, 'recomputeUser')
      .mockRejectedValueOnce(new Error('boom'));
    try {
      await expect(sweeps.sweep(now)).rejects.toThrow('boom');
      expect(await redis.get(SWEEP_WATERMARK_KEY)).toBe(before);
    } finally {
      failing.mockRestore();
    }
    await sweeps.sweep(now);
    expect(await pointsOf(user._id)).toBe(1000);
  });

  it('reads its window through indexes', async () => {
    const problem = await seedProblem(worker);
    await insertGradedRows(worker, 20_000, () => ({
      user: newId(),
      problem: problem._id,
      result: 'WA',
      points: 0,
      casePoints: 0,
      caseTotal: 1,
      at: new Date(Date.now() - 48 * 60 * MINUTE),
    }));
    await redis.set(SWEEP_WATERMARK_KEY, String(Date.now() - MINUTE));
    const operations = await profileQueries(worker.db, () => sweeps.sweep());
    const windowReads = operations.filter(
      ({ collection, operation }) =>
        collection === 'submissions' && operation === 'command',
    );
    expect(windowReads.length).toBeGreaterThan(0);
    expect(
      windowReads.every(({ planSummary }) => !planSummary.includes('COLLSCAN')),
    ).toBe(true);
    expect(
      windowReads.reduce((sum, { docsExamined }) => sum + docsExamined, 0),
    ).toBeLessThan(20_000);
  }, 60_000);

  it('never runs two sweeps at once, even across worker processes', async () => {
    // The harness flushes Redis after boot, which drops the queue's global concurrency.
    await worker.module.get(EffectsSweepProcessor).onApplicationBootstrap();
    await sweepQueueIdle();
    let running = 0;
    let maxRunning = 0;
    let finished = 0;
    const slowSweep = async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await sleep(200);
      running -= 1;
      finished += 1;
      return { users: 0, problems: 0 };
    };
    const spy = jest.spyOn(sweeps, 'sweep').mockImplementation(slowSweep);
    const secondProcess = new Worker(EFFECTS_SWEEP_QUEUE, slowSweep, {
      connection: { url: TEST_REDIS_URL },
      concurrency: 1,
    });
    try {
      await queue.addBulk(
        [1, 2, 3, 4].map(() => ({ name: EFFECTS_SWEEP_JOB, data: {} })),
      );
      await waitUntil(() => finished >= 4, 10_000);
      expect(finished).toBe(4);
      expect(maxRunning).toBe(1);
    } finally {
      await secondProcess.close();
      spy.mockRestore();
    }
  });
});
