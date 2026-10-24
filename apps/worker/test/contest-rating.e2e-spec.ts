import { getQueueToken } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { REDIS } from '@libs/common';
import { waitUntil } from '@libs/common/testing';
import {
  CONTEST_RATING_QUEUE,
  enqueueContestRating,
  MEAN_INIT,
  rankingCacheKeys,
  recalculateRatings,
} from '@libs/contests';
import type { ContestRatingJob } from '@libs/contests';
import { newId, uuidStr } from '@libs/database';
import type { Contest } from '@libs/database';
import { profileQueries } from '@libs/database/testing';
import { ContestRatingRepository } from '../src/jobs/contest-rating/contest-rating.repository';
import { ContestRescoreService } from '../src/jobs/contest-rescore/contest-rescore.service';
import { ContestRatingService } from '../src/jobs/contest-rating/contest-rating.service';
import {
  seedContest,
  seedContestSubmission,
  seedParticipation,
  seedProblem,
  seedUser,
} from './effects-fixtures';
import { setupWorkerTest } from './setup';
import type { WorkerTest } from './setup';

const minutesAgo = (minutes: number): Date =>
  new Date(Date.now() - minutes * 60_000);
const daysAgo = (days: number): Date => minutesAgo(days * 24 * 60);

describe('contest rating', () => {
  let worker: WorkerTest;
  let ratings: ContestRatingService;
  let rescores: ContestRescoreService;
  let problemId: string;
  const queueOf = () =>
    worker.module.get<Queue<ContestRatingJob>>(
      getQueueToken(CONTEST_RATING_QUEUE),
    );
  const ratedContest = (endTime: Date, extra: Partial<Contest> = {}) =>
    seedContest(worker, {
      isRated: true,
      isVisible: true,
      startTime: new Date(endTime.getTime() - 3_600_000),
      endTime,
      problems: [
        {
          problem: problemId,
          points: 100,
          partial: true,
          order: 0,
          isPretested: false,
          outputPrefixOverride: null,
          maxSubmissions: null,
        },
      ],
      ...extra,
    });
  /** A live participation with one contest submission, so it is rated by default. */
  const join = async (
    contestId: string,
    userId: string,
    score: number,
    extra: Record<string, unknown> = {},
  ) => {
    const participation = await seedParticipation(worker, contestId, userId, {
      score,
      ...extra,
    });
    await seedContestSubmission(worker, participation, problemId, {
      points: score,
    });
    return participation;
  };
  /** What an edit of a contest's end triggers: its rescore, whose follow-up re-rates; resolves once the rating queue is idle. */
  const rescoreAndRerate = async (contestId: string) => {
    await rescores.rescore(contestId);
    await waitUntil(async () => {
      const counts = await queueOf().getJobCounts(
        'waiting',
        'active',
        'delayed',
      );
      return counts.waiting + counts.active + counts.delayed === 0;
    });
    expect(await queueOf().getFailedCount()).toBe(0);
  };
  const ratingRows = async (contestId: string) =>
    (await worker.ratings.find({ contest: contestId }).lean()).map((row) => ({
      user: uuidStr(row.user),
      rank: row.rank,
      rating: row.rating,
      mean: row.mean,
    }));
  const userRating = async (userId: string) =>
    (await worker.users.findById(userId).lean())!.rating;
  const newUsers = (...names: string[]) =>
    Promise.all(names.map((username) => seedUser(worker, { username })));

  beforeAll(async () => {
    worker = await setupWorkerTest();
    ratings = worker.module.get(ContestRatingService);
    rescores = worker.module.get(ContestRescoreService);
    problemId = (await seedProblem(worker))._id;
  });
  afterAll(() => worker.teardown());
  beforeEach(async () => {
    // Every rated, ended contest is rated by a run, so a test starts without its predecessors'.
    await worker.contests.deleteMany({});
    await worker.ratings.deleteMany({});
    await queueOf().obliterate({ force: true });
  });

  it('rates live participants with a submission, excluding rateExclude, floors and ceilings', async () => {
    const [alice, bob, carol, dave, eve, newcomer, registered] = await newUsers(
      'rate_alice',
      'rate_bob',
      'rate_carol',
      'rate_dave',
      'rate_eve',
      'rate_newcomer',
      'rate_registered',
    );
    const earlier = await ratedContest(daysAgo(30));
    await worker.ratings.create({
      user: eve._id,
      contest: earlier._id,
      participation: newId(),
      contestEndTime: earlier.endTime,
      rank: 1,
      rating: 2100,
      mean: 2100,
      performance: 2100,
      lastRated: new Date(),
    });
    const contest = await ratedContest(minutesAgo(10), {
      rateExclude: [dave._id],
      ratingCeiling: 2000,
    });
    await join(contest._id, alice._id, 300);
    await join(contest._id, bob._id, 100);
    await seedParticipation(worker, contest._id, carol._id, { score: 0 }); // no submission
    await join(contest._id, dave._id, 200); // excluded
    await join(contest._id, eve._id, 250); // above the ceiling
    await join(contest._id, newcomer._id, 999, { virtual: 1 });
    await seedParticipation(worker, contest._id, registered._id, {
      isRegistered: true,
    });

    await ratings.rateFrom(contest._id);

    const rows = (await ratingRows(contest._id)).sort(
      (left, right) => left.rank - right.rank,
    );
    expect(rows.map((row) => [row.user, row.rank])).toEqual([
      [alice._id, 1],
      [bob._id, 2],
    ]);
    expect(rows[0].rating).toBeGreaterThan(rows[1].rating);
    expect(await userRating(alice._id)).toBe(rows[0].rating);
    expect(await userRating(eve._id)).toBeNull();
  });

  it('leaves unlisted users out of the rating: no rating row, and nobody else moves as if they had played', async () => {
    const [alice, bob, alone, rival] = await newUsers(
      'rate_unl_alice',
      'rate_unl_bob',
      'rate_unl_alone',
      'rate_unl_rival',
    );
    const unlisted = await seedUser(worker, {
      username: 'rate_unl_staff',
      isUnlisted: true,
    });
    const withUnlisted = await ratedContest(minutesAgo(20));
    await join(withUnlisted._id, alice._id, 300);
    await join(withUnlisted._id, unlisted._id, 200);
    await join(withUnlisted._id, bob._id, 100);
    const without = await ratedContest(minutesAgo(10));
    await join(without._id, alone._id, 300);
    await join(without._id, rival._id, 100);

    await ratings.rateFrom(withUnlisted._id);

    const ratingsOf = async (contestId: string) =>
      (await ratingRows(contestId))
        .sort((left, right) => left.rank - right.rank)
        .map(({ rank, rating, mean }) => ({ rank, rating, mean }));
    expect(
      (await ratingRows(withUnlisted._id)).map((row) => row.user).sort(),
    ).toEqual([alice._id, bob._id].sort());
    expect(await ratingsOf(withUnlisted._id)).toEqual(
      await ratingsOf(without._id),
    );
    expect(await userRating(unlisted._id)).toBeNull();
  });

  it('still rates a banned user, who is unlisted too, so a disqualified cheater keeps the last-place penalty', async () => {
    const [winner] = await newUsers('rate_ban_winner');
    const cheater = await seedUser(worker, {
      username: 'rate_ban_cheater',
      isUnlisted: true,
      banReason: 'cheating',
    });
    const contest = await ratedContest(minutesAgo(10));
    await join(contest._id, winner._id, 100);
    await join(contest._id, cheater._id, 300, { isDisqualified: true });

    await ratings.rateFrom(contest._id);

    const rows = (await ratingRows(contest._id)).sort(
      (left, right) => left.rank - right.rank,
    );
    expect(rows.map((row) => row.user)).toEqual([winner._id, cheater._id]);
  });

  it('drops the rating row of a user made unlisted when the contest is re-rated', async () => {
    const [alice, bob, staff] = await newUsers(
      'rate_late_alice',
      'rate_late_bob',
      'rate_late_staff',
    );
    const contest = await ratedContest(minutesAgo(10));
    for (const [user, score] of [
      [alice, 300],
      [staff, 200],
      [bob, 100],
    ] as const)
      await join(contest._id, user._id, score);
    await ratings.rateFrom(contest._id);
    expect(await ratingRows(contest._id)).toHaveLength(3);

    await worker.users.updateOne({ _id: staff._id }, { isUnlisted: true });
    await ratings.rateFrom(contest._id);

    expect(
      (await ratingRows(contest._id)).map((row) => row.user).sort(),
    ).toEqual([alice._id, bob._id].sort());
    expect(await userRating(staff._id)).toBeNull();
  });

  it('keeps a user below the floor out and rates a user at the floor', async () => {
    const [low, edge] = await newUsers('floor_low', 'floor_edge');
    const earlier = await ratedContest(daysAgo(30));
    for (const [user, rating] of [
      [low, 1000],
      [edge, 1100],
    ] as const)
      await worker.ratings.create({
        user: user._id,
        contest: earlier._id,
        participation: newId(),
        contestEndTime: earlier.endTime,
        rank: 1,
        rating,
        mean: rating,
        performance: rating,
        lastRated: new Date(),
      });
    const contest = await ratedContest(minutesAgo(10), { ratingFloor: 1100 });
    await join(contest._id, low._id, 10);
    await join(contest._id, edge._id, 5);
    await ratings.rateFrom(contest._id);
    expect((await ratingRows(contest._id)).map((row) => row.user)).toEqual([
      edge._id,
    ]);
  });

  it('rates everyone who joined with rateAll and shares ranks on ties, disqualified last', async () => {
    const [first, tiedOne, tiedTwo, disqualified, registered] = await newUsers(
      'all_first',
      'all_tied_one',
      'all_tied_two',
      'all_disqualified',
      'all_registered',
    );
    const contest = await ratedContest(minutesAgo(10), { rateAll: true });
    await seedParticipation(worker, contest._id, first._id, { score: 100 });
    await seedParticipation(worker, contest._id, tiedOne._id, { score: 50 });
    await seedParticipation(worker, contest._id, tiedTwo._id, { score: 50 });
    await seedParticipation(worker, contest._id, disqualified._id, {
      score: -9999,
      isDisqualified: true,
    });
    await seedParticipation(worker, contest._id, registered._id, {
      isRegistered: true,
    }); // never joined: not rated even with rateAll
    await ratings.rateFrom(contest._id);
    const rankOf = new Map(
      (await ratingRows(contest._id)).map((row) => [row.user, row.rank]),
    );
    expect(Object.fromEntries(rankOf)).toEqual({
      [first._id]: 1,
      [tiedOne._id]: 2.5,
      [tiedTwo._id]: 2.5,
      [disqualified._id]: 4,
    });
  });

  it('re-rates every later rated contest in end order and repairs users whose rating disappeared', async () => {
    const [alice, bob] = await newUsers('chain_alice', 'chain_bob');
    const first = await ratedContest(daysAgo(3));
    const second = await ratedContest(daysAgo(2));
    const third = await ratedContest(daysAgo(1));
    await join(first._id, alice._id, 200);
    await join(first._id, bob._id, 100);
    await join(second._id, alice._id, 100);
    await join(second._id, bob._id, 200);
    await join(third._id, bob._id, 100);

    await ratings.rateFrom(first._id);
    expect(await worker.ratings.countDocuments()).toBe(5);
    const bobThirdMean = (await ratingRows(third._id))[0].mean;
    const aliceFirstRating = (await ratingRows(first._id)).find(
      (row) => row.user === alice._id,
    )!.rating;

    await worker.contests.updateOne({ _id: second._id }, { isRated: false });
    await ratings.rateFrom(second._id);
    expect(await worker.ratings.countDocuments({ contest: second._id })).toBe(
      0,
    );
    expect((await ratingRows(third._id))[0].mean).not.toBe(bobThirdMean);
    expect(await userRating(alice._id)).toBe(aliceFirstRating);

    expect(await ratings.rateFrom(first._id)).toEqual({
      contests: 2,
      ratings: 3,
    });
    expect(await worker.ratings.countDocuments()).toBe(3);
  });

  it('purges the cached boards of every contest it re-rates, since board rows carry rating changes', async () => {
    const redis = worker.module.get<Redis>(REDIS);
    const [alice, bob] = await newUsers('cache_alice', 'cache_bob');
    const first = await ratedContest(daysAgo(2));
    const second = await ratedContest(daysAgo(1));
    const unrelated = await ratedContest(daysAgo(3));
    await join(first._id, alice._id, 200);
    await join(second._id, bob._id, 100);
    for (const key of [first, second, unrelated].flatMap((contest) =>
      rankingCacheKeys(contest._id),
    ))
      await redis.set(key, '{}');

    await ratings.rateFrom(first._id);

    for (const key of [
      ...rankingCacheKeys(first._id),
      ...rankingCacheKeys(second._id),
    ])
      expect(await redis.exists(key)).toBe(0);
    for (const key of rankingCacheKeys(unrelated._id))
      expect(await redis.exists(key)).toBe(1);
  });

  it('purges the board of a contest that stopped being rated, whose ratings the run deletes', async () => {
    const redis = worker.module.get<Redis>(REDIS);
    const [alice, bob] = await newUsers('unrated_alice', 'unrated_bob');
    const first = await ratedContest(daysAgo(2));
    const second = await ratedContest(daysAgo(1));
    await join(first._id, alice._id, 200);
    await join(second._id, bob._id, 100);
    await ratings.rateFrom(first._id);
    await worker.contests.updateOne({ _id: second._id }, { isRated: false });
    for (const key of rankingCacheKeys(second._id)) await redis.set(key, '{}');

    await ratings.rateFrom(first._id);

    expect(await worker.ratings.countDocuments({ contest: second._id })).toBe(
      0,
    );
    for (const key of rankingCacheKeys(second._id))
      expect(await redis.exists(key)).toBe(0);
  });

  it('reports the committed ratings, naming the boards it could not purge and why', async () => {
    const redis = worker.module.get<Redis>(REDIS);
    const [alice, bob] = await newUsers('user_41', 'user_42');
    const first = await ratedContest(daysAgo(2));
    const second = await ratedContest(daysAgo(1));
    await join(first._id, alice._id, 200);
    await join(second._id, bob._id, 100);
    for (const key of [first, second].flatMap((contest) =>
      rankingCacheKeys(contest._id),
    ))
      await redis.set(key, '{}');
    const realDel = redis.del.bind(redis);
    const del = jest
      .spyOn(redis, 'del')
      .mockImplementation(((...keys: string[]) =>
        keys.some((key) => key.includes(second._id))
          ? Promise.reject(new Error('redis down'))
          : realDel(...keys)) as never);
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    try {
      await expect(ratings.rateFrom(first._id)).resolves.toEqual({
        contests: 2,
        ratings: 2,
      });

      expect(await worker.ratings.countDocuments({})).toBe(2);
      expect(warn).toHaveBeenCalledTimes(1);
      const message = String(warn.mock.calls[0][0]);
      expect(message).toContain(`${second._id} (redis down)`);
      expect(message).not.toContain(first._id);
      expect(message).toContain('expires after scoreboardCacheTimeout');
    } finally {
      del.mockRestore();
      warn.mockRestore();
    }
    for (const key of rankingCacheKeys(first._id))
      expect(await redis.exists(key)).toBe(0);
    for (const key of rankingCacheKeys(second._id))
      expect(await redis.exists(key)).toBe(1);
  });

  it('rates contests ending later after earlier ones, whatever order they were created in', async () => {
    const [alice] = await newUsers('order_alice');
    const late = await ratedContest(daysAgo(1));
    const early = await ratedContest(daysAgo(2));
    await join(late._id, alice._id, 10);
    await join(early._id, alice._id, 10);
    await ratings.rateFrom(early._id);
    const latest = await worker.ratings
      .find({ user: alice._id })
      .sort({ contestEndTime: -1 })
      .lean();
    expect(latest.map((row) => uuidStr(row.contest))).toEqual([
      late._id,
      early._id,
    ]);
    expect(await userRating(alice._id)).toBe(latest[0].rating);
  });

  it('sets users.rating to null when no rating remains', async () => {
    const [alice] = await newUsers('null_alice');
    const contest = await ratedContest(daysAgo(1));
    await join(contest._id, alice._id, 10);
    await ratings.rateFrom(contest._id);
    expect(await userRating(alice._id)).not.toBeNull();
    await worker.contests.updateOne({ _id: contest._id }, { isRated: false });
    await ratings.rateFrom(contest._id);
    expect(await userRating(alice._id)).toBeNull();
  });

  it('does nothing for a contest that has not ended or does not exist', async () => {
    const running = await seedContest(worker, { isRated: true });
    expect(await ratings.rateFrom(running._id)).toEqual({
      contests: 0,
      ratings: 0,
    });
    expect(await ratings.rateFrom(newId())).toEqual({
      contests: 0,
      ratings: 0,
    });
  });

  it('does not rate a contest whose board is still frozen after the end, and keeps its ratings, until the freeze is 0', async () => {
    const [alice, bob] = await newUsers('frozen_alice', 'frozen_bob');
    const contest = await ratedContest(minutesAgo(10), {
      formatName: 'icpc',
      frozenLastMinutes: 30,
    });
    await join(contest._id, alice._id, 5, { frozenScore: 9 });
    await join(contest._id, bob._id, 50, { frozenScore: 1 });

    expect(await ratings.rateFrom(contest._id)).toEqual({
      contests: 0,
      ratings: 0,
    });
    expect(await ratingRows(contest._id)).toEqual([]);
    expect(await userRating(bob._id)).toBeNull();

    await worker.contests.updateOne(
      { _id: contest._id },
      { frozenLastMinutes: 0 },
    );
    await ratings.rateFrom(contest._id);
    const rows = await ratingRows(contest._id);
    expect(rows.find((row) => row.user === bob._id)?.rank).toBe(1);
    expect(rows).toHaveLength(2);

    await worker.contests.updateOne(
      { _id: contest._id },
      { frozenLastMinutes: 30 },
    );
    await ratings.rateFrom(contest._id);
    expect(await ratingRows(contest._id)).toHaveLength(2);
  });

  it('rates no later contest that is still frozen when an earlier one is rated, and matches a from-scratch re-rate once it is unfrozen', async () => {
    const users = await newUsers('chain_frozen_a', 'chain_frozen_b');
    const first = await ratedContest(daysAgo(2));
    const later = await ratedContest(daysAgo(1), {
      formatName: 'icpc',
      frozenLastMinutes: 30,
    });
    for (const contest of [first, later]) {
      await join(contest._id, users[0]._id, contest === first ? 10 : 5);
      await join(contest._id, users[1]._id, contest === first ? 5 : 10);
    }

    await ratings.rateFrom(first._id);
    expect(await worker.ratings.countDocuments({ contest: first._id })).toBe(2);
    expect(await worker.ratings.countDocuments({ contest: later._id })).toBe(0);

    await worker.contests.updateOne(
      { _id: later._id },
      { frozenLastMinutes: 0 },
    );
    await ratings.rateFrom(later._id);
    expect(await worker.ratings.countDocuments({ contest: later._id })).toBe(2);
    const incremental = await allRatings();
    expect(incremental).toEqual(await reRatedFromScratch(first._id));
  });

  it('leaves ratings and users.rating untouched when the run fails midway', async () => {
    const [alice, bob] = await newUsers('atomic_alice', 'atomic_bob');
    const first = await ratedContest(daysAgo(2));
    const second = await ratedContest(daysAgo(1));
    for (const contest of [first, second]) {
      await join(contest._id, alice._id, 10);
      await join(contest._id, bob._id, 5);
    }
    await ratings.rateFrom(first._id);
    const before = await worker.ratings.find().sort({ _id: 1 }).lean();
    const ratingBefore = await userRating(alice._id);
    // The second contest's insert fails after the first contest's rows were re-inserted.
    // eslint-disable-next-line @typescript-eslint/unbound-method -- re-applied with the repository as `this`
    const insert = ContestRatingRepository.prototype.insert;
    let inserts = 0;
    const spy = jest
      .spyOn(ContestRatingRepository.prototype, 'insert')
      .mockImplementation(function (this: ContestRatingRepository, ...args) {
        inserts += 1;
        if (inserts === 2) return Promise.reject(new Error('insert failed'));
        return insert.apply(this, args);
      });
    try {
      await expect(ratings.rateFrom(first._id)).rejects.toThrow(
        'insert failed',
      );
    } finally {
      spy.mockRestore();
    }
    expect(await worker.ratings.find().sort({ _id: 1 }).lean()).toEqual(before);
    expect(await userRating(alice._id)).toBe(ratingBefore);
  });

  it('survives an endTime edit: no duplicate-key error, no stale rows', async () => {
    const [alice, bob] = await newUsers('edit_alice', 'edit_bob');
    const contest = await ratedContest(daysAgo(3));
    const other = await ratedContest(daysAgo(2));
    for (const row of [contest, other]) {
      await join(row._id, alice._id, 10);
      await join(row._id, bob._id, 5);
    }
    await enqueueContestRating(queueOf(), contest._id);
    await waitUntil(async () => (await worker.ratings.countDocuments()) === 4);
    const moved = daysAgo(1);
    await worker.contests.updateOne({ _id: contest._id }, { endTime: moved });
    await rescoreAndRerate(contest._id);
    await waitUntil(
      async () =>
        (await worker.ratings.find({ contest: contest._id }).lean()).every(
          (row) => row.contestEndTime.getTime() === moved.getTime(),
        ) &&
        (await worker.ratings.countDocuments({ contest: contest._id })) === 2,
    );
    expect(await queueOf().getFailedCount()).toBe(0);
    expect(await worker.ratings.countDocuments({ contest: contest._id })).toBe(
      2,
    );
  });

  /** Every rating as comparable rows, whatever the insertion order. */
  const allRatings = async () =>
    (await worker.ratings.find().lean())
      .map((row) => ({
        contest: uuidStr(row.contest),
        user: uuidStr(row.user),
        contestEndTime: row.contestEndTime.getTime(),
        rank: row.rank,
        rating: row.rating,
        mean: row.mean,
        performance: row.performance,
      }))
      .sort(
        (left, right) =>
          left.contest.localeCompare(right.contest) ||
          left.user.localeCompare(right.user),
      );
  /** Three rated contests over three users with different standings in each. */
  const seedStandingsChain = async (prefix: string) => {
    const users = await newUsers(
      `${prefix}_alice`,
      `${prefix}_bob`,
      `${prefix}_carol`,
    );
    const contests = [
      await ratedContest(daysAgo(6)),
      await ratedContest(daysAgo(5)),
      await ratedContest(daysAgo(4)),
    ];
    const scores = [
      [30, 20, 10],
      [10, 30, 20],
      [20, 10, 30],
    ];
    for (const [index, contest] of contests.entries())
      for (const [position, user] of users.entries())
        await join(contest._id, user._id, scores[index][position]);
    return contests;
  };
  const reRatedFromScratch = async (firstContestId: string) => {
    await worker.ratings.deleteMany({});
    await ratings.rateFrom(firstContestId);
    return allRatings();
  };

  it('rates a chain exactly as the formula does on the standings and the previous rows', async () => {
    const [alice, bob] = await newUsers('formula_alice', 'formula_bob');
    const chain = [
      await ratedContest(daysAgo(4)),
      await ratedContest(daysAgo(3)),
      await ratedContest(daysAgo(2)),
    ];
    const scores = [
      [20, 10],
      [10, 20],
      [20, 10],
    ];
    for (const [index, contest] of chain.entries()) {
      await join(contest._id, alice._id, scores[index][0]);
      await join(contest._id, bob._id, scores[index][1]);
    }

    await ratings.rateFrom(chain[0]._id);

    const expected: Array<
      Array<ReturnType<typeof recalculateRatings>[number]>
    > = [];
    let previous: Array<ReturnType<typeof recalculateRatings>[number]> = [];
    const performances: number[][] = [[], []];
    for (const contestScores of scores) {
      const ranks = contestScores.map((score) =>
        score === Math.max(...contestScores) ? 1 : 2,
      );
      const outputs = recalculateRatings(
        ranks.map((rank, index) => ({
          rank,
          mean: previous[index]?.mean ?? MEAN_INIT,
          history: [...performances[index]].reverse(),
        })),
      );
      outputs.forEach((output, index) =>
        performances[index].push(output.performance),
      );
      expected.push(outputs);
      previous = outputs;
    }
    for (const [index, contest] of chain.entries())
      for (const [position, user] of [alice, bob].entries()) {
        const row = await worker.ratings
          .findOne({ contest: contest._id, user: user._id })
          .lean();
        expect({
          rating: row!.rating,
          mean: row!.mean,
          performance: row!.performance,
        }).toEqual(expected[index][position]);
      }
  });

  it('ranks equal scores with different cumtimes apart and equal cumtimes together', async () => {
    const [fast, slow, tiedOne, tiedTwo] = await newUsers(
      'cum_fast',
      'cum_slow',
      'cum_tied_one',
      'cum_tied_two',
    );
    const contest = await ratedContest(minutesAgo(10));
    await join(contest._id, slow._id, 100, { cumtime: 500 });
    await join(contest._id, fast._id, 100, { cumtime: 100 });
    await join(contest._id, tiedOne._id, 50, { cumtime: 700 });
    await join(contest._id, tiedTwo._id, 50, { cumtime: 700 });
    await ratings.rateFrom(contest._id);
    expect(
      Object.fromEntries(
        (await ratingRows(contest._id)).map((row) => [row.user, row.rank]),
      ),
    ).toEqual({
      [fast._id]: 1,
      [slow._id]: 2,
      [tiedOne._id]: 3.5,
      [tiedTwo._id]: 3.5,
    });
  });

  it('does not rate a rated contest that has not ended yet', async () => {
    const [alice] = await newUsers('future_alice');
    const ended = await ratedContest(daysAgo(1));
    const running = await ratedContest(new Date(Date.now() + 3_600_000));
    await join(ended._id, alice._id, 10);
    await join(running._id, alice._id, 10);
    expect(await ratings.rateFrom(ended._id)).toEqual({
      contests: 1,
      ratings: 1,
    });
    expect(await worker.ratings.countDocuments({ contest: running._id })).toBe(
      0,
    );
  });

  it('re-rates the contests between the old and new end when a contest moves later', async () => {
    const [first, second, third] = await seedStandingsChain('later');
    await ratings.rateFrom(first._id);
    const movedEnd = new Date(
      (second.endTime.getTime() + third.endTime.getTime()) / 2,
    );
    await worker.contests.updateOne({ _id: first._id }, { endTime: movedEnd });
    await rescoreAndRerate(first._id);
    const afterMove = await allRatings();
    expect(afterMove.filter((row) => row.contest === first._id)).toHaveLength(
      3,
    );
    expect(afterMove).toEqual(await reRatedFromScratch(second._id));
  });

  it('keeps and re-rates a contest that moves earlier than the target it was rated from', async () => {
    const [first, , third] = await seedStandingsChain('earlier');
    await ratings.rateFrom(first._id);
    const movedEnd = new Date(first.endTime.getTime() - 86_400_000);
    await worker.contests.updateOne({ _id: third._id }, { endTime: movedEnd });
    await rescoreAndRerate(third._id);
    const afterMove = await allRatings();
    expect(afterMove.filter((row) => row.contest === third._id)).toHaveLength(
      3,
    );
    expect(afterMove).toEqual(await reRatedFromScratch(third._id));
  });

  it('keeps the ratings of a contest moved before the target when only the target is rated', async () => {
    const [first, second, third] = await seedStandingsChain('misplaced');
    await ratings.rateFrom(first._id);
    const movedEnd = new Date(
      (first.endTime.getTime() + second.endTime.getTime()) / 2,
    );
    await worker.contests.updateOne({ _id: third._id }, { endTime: movedEnd });
    await ratings.rateFrom(second._id);
    const afterRun = await allRatings();
    expect(afterRun.filter((row) => row.contest === third._id)).toHaveLength(3);
    expect(afterRun).toEqual(await reRatedFromScratch(first._id));
  });

  it('drops the ratings of a rated contest that was extended into the future', async () => {
    const [first, second] = await seedStandingsChain('extended');
    await ratings.rateFrom(first._id);
    await worker.contests.updateOne(
      { _id: first._id },
      { endTime: new Date(Date.now() + 3_600_000) },
    );
    await rescoreAndRerate(first._id);
    expect(await worker.ratings.countDocuments({ contest: first._id })).toBe(0);
    expect(await worker.ratings.countDocuments()).toBe(6);
    expect(await allRatings()).toEqual(await reRatedFromScratch(second._id));
  });

  it('rates a chain of 8 contests of 10 users through indexes', async () => {
    const contestCount = 8;
    const userCount = 10;
    const users = await Promise.all(
      Array.from({ length: userCount }, (_unused, index) =>
        seedUser(worker, { username: `chain_user${index}` }),
      ),
    );
    const contests: Array<Awaited<ReturnType<typeof ratedContest>>> = [];
    for (let index = 0; index < contestCount; index += 1)
      contests.push(await ratedContest(daysAgo(contestCount - index + 1)));
    const participations = contests.flatMap((contest, contestIndex) =>
      users.map((user, userIndex) => ({
        _id: newId(),
        contest: contest._id,
        user: user._id,
        realStart: contest.startTime,
        score: (userIndex * 7 + contestIndex * 3) % userCount,
      })),
    );
    await worker.participations.insertMany(participations);
    await worker.submissions.insertMany(
      participations.map((participation) => ({
        _id: participation._id,
        user: participation.user,
        problem: problemId,
        contest: participation.contest,
        language: newId(),
        status: 'D',
        result: 'AC',
        points: 1,
        casePoints: 1,
        caseTotal: 1,
      })),
    );
    await worker.contestSubmissions.insertMany(
      participations.map((participation) => ({
        _id: participation._id,
        participation: participation._id,
        contest: participation.contest,
        problem: problemId,
        points: 1,
      })),
    );

    const operations = await profileQueries(worker.db, () =>
      ratings.rateFrom(contests[0]._id),
    );

    expect(
      operations.filter((operation) => operation.planSummary === 'COLLSCAN'),
    ).toEqual([]);
    expect(await worker.ratings.countDocuments()).toBe(
      contestCount * userCount,
    );
    const [latest] = await worker.ratings
      .find({ user: users[0]._id })
      .sort({ contestEndTime: -1 })
      .limit(1)
      .lean();
    expect(await userRating(users[0]._id)).toBe(latest.rating);
  });

  it('rates no hidden contest: a run from an earlier contest skips it', async () => {
    const [alice, bob] = await newUsers('hidden_alice', 'hidden_bob');
    const earlier = await ratedContest(daysAgo(2));
    const hidden = await ratedContest(daysAgo(1), { isVisible: false });
    await join(earlier._id, alice._id, 200);
    await join(earlier._id, bob._id, 100);
    await join(hidden._id, alice._id, 100);
    await join(hidden._id, bob._id, 200);

    expect(await ratings.rateFrom(earlier._id)).toEqual({
      contests: 1,
      ratings: 2,
    });
    expect(await ratingRows(hidden._id)).toEqual([]);
  });

  it('counts no submission on a problem removed from the contest', async () => {
    const [alice, bob] = await newUsers('removed_alice', 'removed_bob');
    const removedProblem = await seedProblem(worker);
    const contest = await ratedContest(minutesAgo(10));
    await join(contest._id, alice._id, 100);
    const onRemovedOnly = await seedParticipation(worker, contest._id, bob._id);
    await seedContestSubmission(worker, onRemovedOnly, removedProblem._id, {
      points: 100,
    });

    await ratings.rateFrom(contest._id);

    expect((await ratingRows(contest._id)).map((row) => row.user)).toEqual([
      alice._id,
    ]);
  });

  it('runs one rating at a time through the queue', async () => {
    const [alice, bob] = await newUsers('queue_alice', 'queue_bob');
    const first = await ratedContest(daysAgo(2));
    const second = await ratedContest(daysAgo(1));
    for (const contest of [first, second]) {
      await join(contest._id, alice._id, 10);
      await join(contest._id, bob._id, 5);
    }
    await enqueueContestRating(queueOf(), first._id);
    await enqueueContestRating(queueOf(), second._id);
    await waitUntil(async () => {
      const counts = await queueOf().getJobCounts(
        'active',
        'waiting',
        'delayed',
      );
      return counts.active + counts.waiting + counts.delayed === 0;
    });
    expect(await queueOf().getFailedCount()).toBe(0);
    for (const contest of [first, second])
      expect(
        await worker.ratings.countDocuments({ contest: contest._id }),
      ).toBe(2);
    for (const user of [alice, bob])
      expect(await worker.ratings.countDocuments({ user: user._id })).toBe(2);
  });
});
