import { getQueueToken } from '@nestjs/bullmq';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { REDIS } from '@libs/common';
import { childPath } from '@libs/community';
import {
  CONTEST_RATING_QUEUE,
  MEAN_INIT,
  rankingCacheKeys,
  recalculateRatings,
} from '@libs/contests';
import { newId, uuidStr } from '@libs/database';
import {
  MIGRATION_REFUSAL,
  MIGRATION_STATE_COLLECTION,
  MIGRATION_STATE_ID,
} from '@libs/judging';
import type { Connection } from 'mongoose';
import { MigrationRecomputeService } from '../src/jobs/migration-recompute/migration-recompute.service';
import {
  seedContest,
  seedContestSubmission,
  seedGraded,
  seedOrganization,
  seedParticipation,
  seedProblem,
  seedUser,
} from './effects-fixtures';
import { setupWorkerTest } from './setup';
import type { WorkerTest } from './setup';

const DAY_MS = 86_400_000;

describe('migration recompute', () => {
  let worker: WorkerTest;
  const ratingJobCounts = () =>
    worker.module
      .get<Queue>(getQueueToken(CONTEST_RATING_QUEUE))
      .getJobCounts('waiting', 'delayed', 'active');

  const marker = () =>
    worker.module
      .get<Connection>(getConnectionToken())
      .collection<{ _id: string }>(MIGRATION_STATE_COLLECTION);
  const mark = () =>
    marker().updateOne(
      { _id: MIGRATION_STATE_ID },
      { $set: { since: new Date() } },
      { upsert: true },
    );

  beforeAll(async () => {
    worker = await setupWorkerTest();
    await mark();
  });
  afterAll(() => worker.teardown());

  it('refuses to run, and keeps every rating, without the migration marker', async () => {
    const user = await seedUser(worker);
    await worker.ratings.create({
      user: user._id,
      contest: newId(),
      participation: newId(),
      contestEndTime: new Date(),
      rank: 1,
      rating: 1700,
      mean: 1700,
      performance: 1700,
      lastRated: new Date(),
    });
    await marker().deleteOne({ _id: MIGRATION_STATE_ID });
    const ratingsBefore = await worker.ratings.countDocuments();

    await expect(
      worker.module.get(MigrationRecomputeService).run(),
    ).rejects.toThrow(MIGRATION_REFUSAL);

    expect(await worker.ratings.countDocuments()).toBe(ratingsBefore);
    await mark();
    await expect(
      worker.module.get(MigrationRecomputeService).run(),
    ).resolves.toMatchObject({ users: await worker.users.countDocuments() });
  });

  it('recomputes every derived value from migrated rows', async () => {
    const organization = await seedOrganization(worker);
    const user = await seedUser(worker, {
      organizations: [organization._id],
      points: 0,
      problemCount: 0,
    });
    const problem = await seedProblem(worker, { userCount: 0, acRate: 0 });
    await seedGraded(worker, uuidStr(user._id), uuidStr(problem._id));
    const contest = await seedContest(worker, {
      problems: [{ problem: problem._id, points: 100, order: 0 } as never],
    });
    const participation = await seedParticipation(
      worker,
      uuidStr(contest._id),
      uuidStr(user._id),
      { score: 0 },
    );
    await seedContestSubmission(worker, participation, uuidStr(problem._id), {
      points: 100,
    });
    const commentId = newId();
    await worker.comments.create({
      _id: commentId,
      page: { type: 'blog', id: newId() },
      author: user._id,
      threadId: commentId,
      path: childPath(null, commentId),
      body: 'x',
      score: 3,
    });
    const redis = worker.module.get<Redis>(REDIS);
    const [rankingKey] = rankingCacheKeys(uuidStr(contest._id));
    await redis.set(rankingKey, 'stale');

    const result = await worker.module.get(MigrationRecomputeService).run();

    expect(result).toMatchObject({
      users: await worker.users.countDocuments(),
      participations: await worker.participations.countDocuments(),
    });
    const recomputedUser = (await worker.users.findById(user._id).lean())!;
    expect(recomputedUser.problemCount).toBe(1);
    expect(recomputedUser.points).toBeGreaterThan(0);
    expect(recomputedUser.contributionPoints).toBeGreaterThan(0);
    expect(
      (await worker.problems.findById(problem._id).lean())!.userCount,
    ).toBe(1);
    expect(
      (await worker.organizations.findById(organization._id).lean())!
        .memberCount,
    ).toBe(1);
    const cells = (await worker.participations
      .findById(participation._id)
      .lean())!;
    expect(cells.score).toBe(100);
    expect(Object.keys(cells.formatData)).toEqual([uuidStr(problem._id)]);
    expect(await redis.exists(rankingKey)).toBe(0);
  });

  it('re-rates every rated, ended, unfrozen contest from scratch, idempotently, without queueing jobs', async () => {
    const problem = await seedProblem(worker);
    const endTime = new Date(Date.now() - DAY_MS);
    const startTime = new Date(endTime.getTime() - 3_600_000);
    const problems = [{ problem: problem._id, points: 100, order: 0 } as never];
    const rated = await seedContest(worker, {
      isRated: true,
      startTime,
      endTime,
      problems,
    });
    const frozen = await seedContest(worker, {
      isRated: true,
      startTime,
      endTime,
      problems,
      formatName: 'icpc',
      frozenLastMinutes: 30,
    });
    // A legacy rating value on the user, and a legacy-looking row: the replay keeps neither.
    const user = await seedUser(worker, { rating: 2900 });
    const join = async (contestId: string) => {
      const participation = await seedParticipation(
        worker,
        contestId,
        uuidStr(user._id),
        { realStart: startTime, score: 100 },
      );
      await seedContestSubmission(worker, participation, uuidStr(problem._id), {
        points: 100,
      });
      return participation;
    };
    const participation = await join(uuidStr(rated._id));
    await join(uuidStr(frozen._id));
    await worker.ratings.create({
      user: user._id,
      contest: newId(),
      participation: newId(),
      contestEndTime: new Date(endTime.getTime() - DAY_MS),
      rank: 1,
      rating: 2900,
      mean: 2900,
      performance: 2900,
      lastRated: endTime,
    });
    const service = worker.module.get(MigrationRecomputeService);
    const rows = async () =>
      (await worker.ratings.find({}).sort({ contestEndTime: 1 }).lean()).map(
        (row) => [
          uuidStr(row.participation),
          row.rank,
          row.rating,
          row.mean,
          row.performance,
        ],
      );

    const first = await service.run();

    // One participant, no history: the v2 library's own output for rank 1.
    const [expected] = recalculateRatings([
      { rank: 1, mean: MEAN_INIT, history: [] },
    ]);
    expect(first).toMatchObject({
      ratedContests: 1,
      ratings: 1,
      frozenRatedContests: 1,
    });
    expect(await rows()).toEqual([
      [
        uuidStr(participation._id),
        1,
        expected.rating,
        expected.mean,
        expected.performance,
      ],
    ]);
    expect((await worker.users.findById(user._id).lean())!.rating).toBe(
      expected.rating,
    );
    const once = await rows();
    await expect(service.run()).resolves.toMatchObject({
      ratedContests: 1,
      ratings: 1,
    });
    expect(await rows()).toEqual(once);
    expect(
      Object.values(await ratingJobCounts()).every((count) => count === 0),
    ).toBe(true);
  });

  it('replays several contests in end order, skipping frozen, virtual and unsubmitted rows, and clears the other ratings', async () => {
    await worker.ratings.deleteMany({});
    await worker.participations.deleteMany({});
    await worker.contestSubmissions.deleteMany({});
    await worker.contests.deleteMany({});
    await worker.users.deleteMany({});
    const problem = await seedProblem(worker);
    const problems = [{ problem: problem._id, points: 100, order: 0 } as never];
    const contest = (endDaysAgo: number, extra = {}) => {
      const endTime = new Date(Date.now() - endDaysAgo * DAY_MS);
      const startTime = new Date(endTime.getTime() - 3_600_000);
      return seedContest(worker, {
        isRated: true,
        startTime,
        endTime,
        problems,
        ...extra,
      });
    };
    // Inserted out of end order: the later-ending contest has the smaller id.
    const late = await contest(2);
    const early = await contest(3);
    const frozen = await contest(4, {
      formatName: 'icpc',
      frozenLastMinutes: 30,
    });
    expect(uuidStr(late._id) < uuidStr(early._id)).toBe(true);
    const [userA, userB, userC, stale, virtualOnly, unsubmitted] = [
      await seedUser(worker),
      await seedUser(worker),
      await seedUser(worker),
      await seedUser(worker, { rating: 2900 }),
      await seedUser(worker, { rating: 2800 }),
      await seedUser(worker, { rating: 1111 }),
    ];
    const join = async (
      where: { _id: string; startTime: Date },
      user: { _id: string },
      points: number | null,
      extra = {},
    ) => {
      const participation = await seedParticipation(
        worker,
        uuidStr(where._id),
        uuidStr(user._id),
        { realStart: where.startTime, ...extra },
      );
      if (points !== null)
        await seedContestSubmission(
          worker,
          participation,
          uuidStr(problem._id),
          { points },
        );
      return participation;
    };
    const earlyA = await join(early, userA, 100);
    const earlyB = await join(early, userB, 50);
    await join(early, virtualOnly, 100, { virtual: 1 });
    const lateA = await join(late, userA, 50);
    const lateB = await join(late, userB, 100);
    const lateC = await join(late, userC, 70);
    await join(late, unsubmitted, null);
    await join(frozen, userA, 100);
    await join(frozen, userB, 50);
    // The v2 library, fed by hand: the first contest from scratch, the second from the first's outputs.
    const [firstA, firstB] = recalculateRatings([
      { rank: 1, mean: MEAN_INIT, history: [] },
      { rank: 2, mean: MEAN_INIT, history: [] },
    ]);
    const [secondB, secondC, secondA] = recalculateRatings([
      { rank: 1, mean: firstB.mean, history: [firstB.performance] },
      { rank: 2, mean: MEAN_INIT, history: [] },
      { rank: 3, mean: firstA.mean, history: [firstA.performance] },
    ]);
    const row = (id: string, rank: number, out: typeof firstA) => [
      id,
      rank,
      out.rating,
      out.mean,
      out.performance,
    ];
    const expectedRows = [
      row(uuidStr(earlyA._id), 1, firstA),
      row(uuidStr(earlyB._id), 2, firstB),
      row(uuidStr(lateB._id), 1, secondB),
      row(uuidStr(lateC._id), 2, secondC),
      row(uuidStr(lateA._id), 3, secondA),
    ];
    const snapshot = async () => ({
      rows: (
        await worker.ratings
          .find({})
          .sort({ contestEndTime: 1, rank: 1 })
          .lean()
      ).map((entry) => [
        uuidStr(entry.participation),
        entry.rank,
        entry.rating,
        entry.mean,
        entry.performance,
      ]),
      users: (await worker.users.find({}).lean())
        .map((user) => [uuidStr(user._id), user.rating])
        .sort(),
    });
    const service = worker.module.get(MigrationRecomputeService);

    const first = await service.run();

    expect(first).toMatchObject({
      ratedContests: 2,
      ratings: 5,
      frozenRatedContests: 1,
    });
    const once = await snapshot();
    expect(once.rows).toEqual(expectedRows);
    const ratingOf = (user: { _id: string }) =>
      once.users.find(([id]) => id === uuidStr(user._id))![1];
    expect([userA, userB, userC].map(ratingOf)).toEqual([
      secondA.rating,
      secondB.rating,
      secondC.rating,
    ]);
    expect([stale, virtualOnly, unsubmitted].map(ratingOf)).toEqual([
      null,
      null,
      null,
    ]);
    await service.run();
    expect(await snapshot()).toEqual(once);
  });
});
