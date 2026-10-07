import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { waitUntil } from '@libs/common/testing';
import { CONTEST_RATING_QUEUE, enqueueContestRating } from '@libs/contests';
import type { ContestRatingJob } from '@libs/contests';
import { newId, uuidStr } from '@libs/database';
import type { Contest } from '@libs/database';
import { profileQueries } from '@libs/database/testing';
import { ContestRatingRepository } from '../src/jobs/contest-rating/contest-rating.repository';
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
  let problemId: string;
  const queueOf = () =>
    worker.module.get<Queue<ContestRatingJob>>(
      getQueueToken(CONTEST_RATING_QUEUE),
    );
  const ratedContest = (endTime: Date, extra: Partial<Contest> = {}) =>
    seedContest(worker, {
      isRated: true,
      startTime: new Date(endTime.getTime() - 3_600_000),
      endTime,
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
    await seedContestSubmission(worker, participation, problemId);
    return participation;
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
    await enqueueContestRating(queueOf(), contest._id);
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

  it('rates a chain of 30 contests of 40 users through indexes', async () => {
    const contestCount = 30;
    const userCount = 40;
    const users = await Promise.all(
      Array.from({ length: userCount }, (_unused, index) =>
        seedUser(worker, { username: `chain30_user${index}` }),
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
