import { getQueueToken } from '@nestjs/bullmq';
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

  beforeAll(async () => {
    worker = await setupWorkerTest();
  });
  afterAll(() => worker.teardown());

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
});
