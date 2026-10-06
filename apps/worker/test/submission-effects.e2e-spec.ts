import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { waitUntil } from '@libs/common/testing';
import { newId } from '@libs/database';
import { profileQueries } from '@libs/database/testing';
import {
  enqueueGraded,
  gradedJobOf,
  SUBMISSION_GRADED_QUEUE,
} from '@libs/judging';
import type { SubmissionGradedJob } from '@libs/judging';
import { SubmissionEffectsService } from '../src/jobs/submission-effects/submission-effects.service';
import {
  insertGradedRows,
  problemFields,
  seedGraded,
  seedProblem,
  seedUser,
} from './effects-fixtures';
import { setupWorkerTest } from './setup';
import type { WorkerTest } from './setup';

const geometric = (count: number) => (1 - 0.98514 ** count) / (1 - 0.98514);

describe('submission effects', () => {
  let worker: WorkerTest;
  let effects: SubmissionEffectsService;
  const pointsOf = async (userId: string) =>
    (await worker.users
      .findById(userId, { points: 1, performancePoints: 1, problemCount: 1 })
      .lean())!;
  const statsOf = async (problemId: string) =>
    (await worker.problems
      .findById(problemId, { userCount: 1, acRate: 1 })
      .lean())!;

  beforeAll(async () => {
    worker = await setupWorkerTest();
    effects = worker.module.get(SubmissionEffectsService);
  });
  afterAll(() => worker.teardown());

  it('recomputes user points like legacy calculate_points: best per public problem, private and organisation-private problems ignored', async () => {
    const user = await seedUser(worker);
    const first = await seedProblem(worker, { points: 1000 });
    const second = await seedProblem(worker, { points: 800 });
    const hidden = await seedProblem(worker, { isPublic: false });
    const orgPrivate = await seedProblem(worker, {
      isOrganizationPrivate: true,
    });
    await seedGraded(worker, user._id, first._id, {
      result: 'WA',
      points: 500,
      casePoints: 1,
      caseTotal: 2,
    });
    await seedGraded(worker, user._id, first._id, {
      points: 1000,
      casePoints: 2,
      caseTotal: 2,
    });
    await seedGraded(worker, user._id, second._id, {
      result: 'WA',
      points: 200,
      casePoints: 1,
      caseTotal: 4,
    });
    await seedGraded(worker, user._id, second._id, {
      status: 'CE',
      result: 'CE',
      points: null,
      casePoints: 0,
      caseTotal: 0,
    });
    await seedGraded(worker, user._id, hidden._id);
    await seedGraded(worker, user._id, orgPrivate._id);
    await effects.recomputeUser(user._id);
    const recomputed = await pointsOf(user._id);
    expect(recomputed).toMatchObject({ points: 1200, problemCount: 1 });
    expect(recomputed.performancePoints).toBeCloseTo(
      1000 + 0.98514 * 200 + 0.05,
      9,
    );
  });

  it('counts a problem as solved only for an AC whose cases earned everything', async () => {
    const user = await seedUser(worker);
    const problem = await seedProblem(worker);
    await seedGraded(worker, user._id, problem._id, {
      points: 750,
      casePoints: 3,
      caseTotal: 4,
    });
    await effects.recomputeUser(user._id);
    expect(await pointsOf(user._id)).toMatchObject({
      points: 750,
      performancePoints: 750,
      problemCount: 0,
    });
  });

  it('weighs only the 300 best problems in performance points', async () => {
    const user = await seedUser(worker);
    const solved = await worker.problems.insertMany(
      Array.from({ length: 301 }, () => problemFields({ points: 800 })),
    );
    await insertGradedRows(worker, solved.length, (index) => ({
      user: user._id,
      problem: solved[index]._id,
      result: 'AC',
      points: 800,
      casePoints: 1,
      caseTotal: 1,
    }));
    await effects.recomputeUser(user._id);
    const recomputed = await pointsOf(user._id);
    expect(recomputed).toMatchObject({ points: 301 * 800, problemCount: 301 });
    expect(recomputed.performancePoints).toBeCloseTo(
      800 * geometric(300) + 0.05 * 301,
      6,
    );
  });

  it('recomputes problem stats like legacy update_stats: unlisted users left out, AC worth full points', async () => {
    const problem = await seedProblem(worker, { points: 1000 });
    const [alice, bob, carol, erin, frank] = await Promise.all(
      [1, 2, 3, 4, 5].map(() => seedUser(worker)),
    );
    const dave = await seedUser(worker, { isUnlisted: true });
    await seedGraded(worker, alice._id, problem._id);
    await seedGraded(worker, alice._id, problem._id);
    await seedGraded(worker, bob._id, problem._id);
    await seedGraded(worker, carol._id, problem._id, {
      result: 'WA',
      points: 0,
      casePoints: 0,
    });
    await seedGraded(worker, dave._id, problem._id);
    await seedGraded(worker, erin._id, problem._id, {
      points: 500,
      casePoints: 1,
      caseTotal: 2,
    });
    // Full cases but below the problem's points (re-pointed since): legacy `update_stats` does not count it.
    await seedGraded(worker, frank._id, problem._id, {
      points: 500,
      casePoints: 1,
      caseTotal: 1,
    });
    await effects.recomputeProblem(problem._id);
    expect(await statsOf(problem._id)).toMatchObject({
      userCount: 2,
      acRate: 50,
    });
  });

  it('applies a queued graded job: the user of a public problem and the problem', async () => {
    const queue = worker.module.get<Queue<SubmissionGradedJob>>(
      getQueueToken(SUBMISSION_GRADED_QUEUE),
    );
    const user = await seedUser(worker);
    const problem = await seedProblem(worker, { points: 1200 });
    const submission = await seedGraded(worker, user._id, problem._id, {
      points: 1200,
    });
    await enqueueGraded(queue, gradedJobOf(submission));
    await waitUntil(async () => (await statsOf(problem._id)).userCount === 1);
    expect(await statsOf(problem._id)).toMatchObject({ acRate: 100 });
    await waitUntil(async () => (await pointsOf(user._id)).points === 1200);
    expect((await pointsOf(user._id)).problemCount).toBe(1);
  });

  it('leaves user points alone for a job on a private problem (legacy gate) but updates its stats', async () => {
    const user = await seedUser(worker, { points: 123 });
    const problem = await seedProblem(worker, { isPublic: false });
    const submission = await seedGraded(worker, user._id, problem._id);
    await effects.apply(gradedJobOf(submission));
    expect((await pointsOf(user._id)).points).toBe(123);
    expect(await statsOf(problem._id)).toMatchObject({
      userCount: 1,
      acRate: 100,
    });
  });

  it('is idempotent: the same job twice, or a job for a deleted problem, changes nothing more', async () => {
    const user = await seedUser(worker);
    const problem = await seedProblem(worker);
    const submission = await seedGraded(worker, user._id, problem._id);
    await effects.apply(gradedJobOf(submission));
    const once = [await pointsOf(user._id), await statsOf(problem._id)];
    await effects.apply(gradedJobOf(submission));
    expect([await pointsOf(user._id), await statsOf(problem._id)]).toEqual(
      once,
    );
    await expect(
      effects.apply({
        submissionId: newId(),
        userId: user._id,
        problemId: newId(),
      }),
    ).resolves.toBeUndefined();
    expect(await pointsOf(user._id)).toEqual(once[0]);
  });

  it('recomputes a user with 10k submissions through indexes', async () => {
    const user = await seedUser(worker);
    const solved = await worker.problems.insertMany(
      Array.from({ length: 2000 }, () => problemFields({ points: 800 })),
    );
    await insertGradedRows(worker, 10_000, (index) => ({
      user: user._id,
      problem: solved[index % 2000]._id,
      result: index < 2000 ? 'AC' : 'WA',
      points: index < 2000 ? 800 : 400,
      casePoints: index < 2000 ? 2 : 1,
      caseTotal: 2,
    }));
    await insertGradedRows(worker, 10_000, (index) => ({
      user: newId(),
      problem: solved[index % 2000]._id,
      result: 'AC',
      points: 800,
      casePoints: 1,
      caseTotal: 1,
    }));
    const operations = await profileQueries(worker.db, () =>
      effects.recomputeUser(user._id),
    );
    const reads = operations.filter(
      ({ collection }) => collection === 'submissions',
    );
    expect(reads.length).toBeGreaterThan(0);
    expect(
      reads.every(({ planSummary }) => !planSummary.includes('COLLSCAN')),
    ).toBe(true);
    // A collection scan would read the other users' 10k rows too.
    expect(
      reads.reduce((sum, { docsExamined }) => sum + docsExamined, 0),
    ).toBeLessThan(20_000);
    const recomputed = await pointsOf(user._id);
    expect(recomputed).toMatchObject({
      points: 2000 * 800,
      problemCount: 2000,
    });
    expect(recomputed.performancePoints).toBeCloseTo(
      800 * geometric(300) + 0.05 * 2000,
      6,
    );
  }, 120_000);

  it('recomputes a problem with 100k submissions through indexes', async () => {
    const problem = await seedProblem(worker, { points: 1000 });
    const other = await seedProblem(worker);
    const unlisted = await Promise.all(
      Array.from({ length: 10 }, () => seedUser(worker, { isUnlisted: true })),
    );
    const userIds = [
      ...unlisted.map((user) => user._id),
      ...Array.from({ length: 990 }, newId),
    ];
    const accepted = (index: number) => index % 10 === 0;
    await insertGradedRows(worker, 100_000, (index) => ({
      user: userIds[index % 1000],
      problem: problem._id,
      result: accepted(index) ? 'AC' : 'WA',
      points: accepted(index) ? 1000 : 0,
      casePoints: accepted(index) ? 1 : 0,
      caseTotal: 1,
    }));
    await insertGradedRows(worker, 20_000, () => ({
      user: newId(),
      problem: other._id,
      result: 'AC',
      points: 1000,
      casePoints: 1,
      caseTotal: 1,
    }));
    const operations = await profileQueries(worker.db, () =>
      effects.recomputeProblem(problem._id),
    );
    for (const name of ['submissions', 'users']) {
      const reads = operations.filter(({ collection }) => collection === name);
      expect(reads.length).toBeGreaterThan(0);
      expect(
        reads.every(({ planSummary }) => !planSummary.includes('COLLSCAN')),
      ).toBe(true);
    }
    const examined = operations
      .filter(({ collection }) => collection === 'submissions')
      .reduce((sum, { docsExamined }) => sum + docsExamined, 0);
    // The total counts listed users' rows from the index alone, no documents.
    expect(
      operations.some(
        ({ collection, planSummary, docsExamined }) =>
          collection === 'submissions' &&
          planSummary.includes('{ problem: 1, user: 1 }') &&
          docsExamined === 0,
      ),
    ).toBe(true);
    // A collection scan would also read the other problem's 20k rows.
    expect(examined).toBeLessThan(120_000);
    // 99000 rows of listed users, 9900 of them AC with full points, from 99 users.
    expect(await statsOf(problem._id)).toMatchObject({
      userCount: 99,
      acRate: 10,
    });
  }, 120_000);
});
