import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { waitUntil } from '@libs/common/testing';
import { enqueueRescore, PROBLEM_RESCORE_QUEUE } from '@libs/judging';
import type { ProblemRescoreJob } from '@libs/judging';
import { ProblemRescoreRepository } from '../src/jobs/problem-rescore/problem-rescore.repository';
import type { RescoredRow } from '../src/jobs/problem-rescore/problem-rescore.repository';
import { ProblemRescoreService } from '../src/jobs/problem-rescore/problem-rescore.service';
import {
  insertGradedRows,
  seedGraded,
  seedProblem,
  seedUser,
} from './effects-fixtures';
import { setupWorkerTest } from './setup';
import type { WorkerTest } from './setup';

describe('problem rescore', () => {
  let worker: WorkerTest;
  let rescores: ProblemRescoreService;
  let repository: ProblemRescoreRepository;
  const pointsOf = async (submissionId: string) =>
    (await worker.submissions.findById(submissionId, { points: 1 }).lean())!
      .points;
  const userPointsOf = async (userId: string) =>
    (await worker.users.findById(userId, { points: 1 }).lean())!.points;

  beforeAll(async () => {
    worker = await setupWorkerTest();
    rescores = worker.module.get(ProblemRescoreService);
    repository = worker.module.get(ProblemRescoreRepository);
  });
  afterAll(() => worker.teardown());

  it('rescores graded submissions from their case totals, partial and not, leaving other statuses and rejections alone', async () => {
    const user = await seedUser(worker);
    const problem = await seedProblem(worker, { points: 1000, partial: true });
    const quarter = await seedGraded(worker, user._id, problem._id, {
      result: 'WA',
      points: 250,
      casePoints: 1,
      caseTotal: 4,
    });
    const full = await seedGraded(worker, user._id, problem._id, {
      casePoints: 4,
      caseTotal: 4,
    });
    const rejected = await seedGraded(worker, user._id, problem._id, {
      result: 'RJ',
      points: 0,
      casePoints: 4,
      caseTotal: 4,
    });
    const compileError = await seedGraded(worker, user._id, problem._id, {
      status: 'CE',
      result: 'CE',
      points: null,
      casePoints: 0,
      caseTotal: 0,
    });
    const queued = await seedGraded(worker, user._id, problem._id, {
      status: 'QU',
      result: null,
      points: null,
      casePoints: 0,
      caseTotal: 0,
    });
    await worker.problems.updateOne({ _id: problem._id }, { points: 2000 });
    expect(await rescores.rescore(problem._id)).toEqual({
      rescored: 2,
      users: 1,
    });
    expect(await pointsOf(quarter._id)).toBe(500);
    expect(await pointsOf(full._id)).toBe(2000);
    expect(await pointsOf(rejected._id)).toBe(0);
    expect(await pointsOf(compileError._id)).toBeNull();
    expect(await pointsOf(queued._id)).toBeNull();
    expect(await userPointsOf(user._id)).toBe(2000);
    expect(
      await worker.problems
        .findById(problem._id, { userCount: 1, acRate: 1 })
        .lean(),
    ).toMatchObject({ userCount: 1, acRate: 20 });

    await worker.problems.updateOne({ _id: problem._id }, { partial: false });
    await rescores.rescore(problem._id);
    expect(await pointsOf(quarter._id)).toBe(0);
    expect(await pointsOf(full._id)).toBe(2000);
  });

  it('is idempotent: a second run writes nothing and changes nothing', async () => {
    const user = await seedUser(worker);
    const problem = await seedProblem(worker);
    const submission = await seedGraded(worker, user._id, problem._id, {
      result: 'WA',
      points: 100,
      casePoints: 1,
      caseTotal: 3,
    });
    await rescores.rescore(problem._id);
    const once = await pointsOf(submission._id);
    expect(once).toBe(333.333);
    expect((await rescores.rescore(problem._id)).rescored).toBe(0);
    expect(await pointsOf(submission._id)).toBe(once);
  });

  it('drops a write computed from case totals that changed meanwhile', async () => {
    const user = await seedUser(worker);
    const problem = await seedProblem(worker);
    const submission = await seedGraded(worker, user._id, problem._id, {
      result: 'WA',
      points: 250,
      casePoints: 1,
      caseTotal: 4,
    });
    // A rejudge finished with new totals after the rescore read the row.
    await worker.submissions.updateOne(
      { _id: submission._id },
      { casePoints: 3, points: 750 },
    );
    const stale: RescoredRow = {
      id: submission._id,
      casePoints: 1,
      caseTotal: 4,
      points: 999,
    };
    expect(await repository.setPoints([stale])).toBe(0);
    expect(await pointsOf(submission._id)).toBe(750);
  });

  it('drops a write to a row whose rejudge began meanwhile', async () => {
    const user = await seedUser(worker);
    const problem = await seedProblem(worker);
    const submission = await seedGraded(worker, user._id, problem._id, {
      result: 'WA',
      points: 250,
      casePoints: 1,
      caseTotal: 4,
    });
    await worker.submissions.updateOne(
      { _id: submission._id },
      { status: 'G' },
    );
    const stale: RescoredRow = {
      id: submission._id,
      casePoints: 1,
      caseTotal: 4,
      points: 999,
    };
    expect(await repository.setPoints([stale])).toBe(0);
    expect(await pointsOf(submission._id)).toBe(250);
  });

  it('follows the problem publicity in its users points', async () => {
    const user = await seedUser(worker);
    const problem = await seedProblem(worker, { isPublic: false });
    await seedGraded(worker, user._id, problem._id);
    await rescores.rescore(problem._id);
    expect(await userPointsOf(user._id)).toBe(0);
    await worker.problems.updateOne({ _id: problem._id }, { isPublic: true });
    await rescores.rescore(problem._id);
    expect(await userPointsOf(user._id)).toBe(1000);
    await worker.problems.updateOne(
      { _id: problem._id },
      { isOrganizationPrivate: true },
    );
    await rescores.rescore(problem._id);
    expect(await userPointsOf(user._id)).toBe(0);
  });

  it('rescores nothing for a deleted problem (its delete event queues one)', async () => {
    const user = await seedUser(worker);
    const problem = await seedProblem(worker, { deletedAt: new Date() });
    await seedGraded(worker, user._id, problem._id);
    expect(await rescores.rescore(problem._id)).toEqual({
      rescored: 0,
      users: 0,
    });
  });

  it('streams a problem past two chunks in chunks of at most 1000 writes', async () => {
    const problem = await seedProblem(worker, { points: 1000, partial: true });
    const userIds = await Promise.all(
      Array.from({ length: 50 }, async () => (await seedUser(worker))._id),
    );
    await insertGradedRows(worker, 2_500, (index) => ({
      user: userIds[index % userIds.length],
      problem: problem._id,
      result: 'WA',
      points: 500,
      casePoints: 1,
      caseTotal: 2,
    }));
    await worker.problems.updateOne({ _id: problem._id }, { points: 2000 });
    const chunkSizes: number[] = [];
    const setPoints = repository.setPoints.bind(repository);
    const spy = jest
      .spyOn(repository, 'setPoints')
      .mockImplementation((rows: RescoredRow[]) => {
        chunkSizes.push(rows.length);
        return setPoints(rows);
      });
    try {
      expect(await rescores.rescore(problem._id)).toEqual({
        rescored: 2_500,
        users: 50,
      });
    } finally {
      spy.mockRestore();
    }
    expect(Math.max(...chunkSizes)).toBeLessThanOrEqual(1000);
    expect(
      await worker.submissions.countDocuments({
        problem: problem._id,
        points: 1000,
      }),
    ).toBe(2_500);
    expect(await userPointsOf(userIds[0])).toBe(1000);
  });

  const queueOf = () =>
    worker.module.get<Queue<ProblemRescoreJob>>(
      getQueueToken(PROBLEM_RESCORE_QUEUE),
    );
  const drained = async () => {
    const counts = await queueOf().getJobCounts('waiting', 'active', 'delayed');
    return counts.waiting + counts.active + counts.delayed === 0;
  };

  it('the rescore queued by an edit made during the previous rescore settles the points', async () => {
    const queue = queueOf();
    const user = await seedUser(worker);
    const problem = await seedProblem(worker, { points: 1000, partial: true });
    await insertGradedRows(worker, 1500, () => ({
      user: user._id,
      problem: problem._id,
      result: 'WA',
      points: 500,
      casePoints: 1,
      caseTotal: 2,
    }));
    // The second edit lands while the first job is active: a dropped (deduplicated) second job leaves 800.
    const rescore = rescores.rescore.bind(rescores);
    const spy = jest
      .spyOn(rescores, 'rescore')
      .mockImplementationOnce(async (problemId) => {
        const result = await rescore(problemId);
        await worker.problems.updateOne({ _id: problemId }, { points: 3000 });
        await enqueueRescore(queue, problemId);
        return result;
      });
    try {
      await worker.problems.updateOne({ _id: problem._id }, { points: 1600 });
      await enqueueRescore(queue, problem._id);
      await waitUntil(() => spy.mock.calls.length === 2, 20_000);
      await waitUntil(drained, 20_000);
    } finally {
      spy.mockRestore();
    }
    expect(
      await worker.submissions.countDocuments({
        problem: problem._id,
        points: 1500,
      }),
    ).toBe(1500);
    expect(await userPointsOf(user._id)).toBe(1500);
  });

  it('retries a failed rescore after its backoff and lands the points without a failure', async () => {
    const queue = queueOf();
    const user = await seedUser(worker);
    const problem = await seedProblem(worker, { points: 1000, partial: true });
    const submission = await seedGraded(worker, user._id, problem._id, {
      result: 'WA',
      points: 100,
      casePoints: 1,
      caseTotal: 2,
    });
    const spy = jest
      .spyOn(rescores, 'rescore')
      .mockRejectedValueOnce(new Error('mongo blip'));
    try {
      await enqueueRescore(queue, problem._id);
      await waitUntil(async () => (await queue.getDelayedCount()) === 1);
      const [retry] = await queue.getJobs(['delayed']);
      expect(retry.attemptsMade).toBe(1);
      expect(await pointsOf(submission._id)).toBe(100);
      await retry.promote();
      await waitUntil(async () => (await pointsOf(submission._id)) === 500);
    } finally {
      spy.mockRestore();
    }
    await waitUntil(drained);
    expect(await queue.getFailedCount()).toBe(0);
  });
});
