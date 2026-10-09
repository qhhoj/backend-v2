import { Logger } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { waitUntil } from '@libs/common/testing';
import {
  CONTEST_RATING_QUEUE,
  CONTEST_REPLAY_JOB,
  CONTEST_REPLAY_QUEUE,
  CONTEST_RESCORE_QUEUE,
  enqueueContestRescore,
} from '@libs/contests';
import type { ContestRescoreJob } from '@libs/contests';
import { newId, toUuid } from '@libs/database';
import { enqueueRescore, PROBLEM_RESCORE_QUEUE } from '@libs/judging';
import { profileQueries } from '@libs/database/testing';
import type { UUID } from 'mongodb';
import { ContestRescoreRepository } from '../src/jobs/contest-rescore/contest-rescore.repository';
import { ContestRescoreService } from '../src/jobs/contest-rescore/contest-rescore.service';
import { ContestResultsRepository } from '../src/jobs/submission-effects/contest-results.repository';
import { ProblemRescoreService } from '../src/jobs/problem-rescore/problem-rescore.service';
import {
  seedContest,
  seedContestSubmission,
  seedParticipation,
  seedProblem,
  seedUser,
} from './effects-fixtures';
import { setupWorkerTest } from './setup';
import type { WorkerTest } from './setup';

describe('contest rescore', () => {
  let worker: WorkerTest;
  let rescores: ContestRescoreService;
  const participationOf = async (id: string) =>
    (await worker.participations.findById(id).lean())!;
  const pointsOf = async (id: string) =>
    (await worker.contestSubmissions.findById(id).lean())!.points;
  const queueOf = () =>
    worker.module.get<Queue<ContestRescoreJob>>(
      getQueueToken(CONTEST_RESCORE_QUEUE),
    );
  const drained = async () => {
    const counts = await queueOf().getJobCounts('waiting', 'active', 'delayed');
    return counts.waiting + counts.active + counts.delayed === 0;
  };
  const contestWith = async (contestFields: object = {}) => {
    const problem = await seedProblem(worker, { points: 1000, partial: true });
    const contest = await seedContest(worker, {
      problems: [
        {
          problem: problem._id,
          points: 100,
          partial: true,
          order: 0,
          isPretested: false,
          outputPrefixOverride: null,
          maxSubmissions: null,
        },
      ],
      ...contestFields,
    });
    const participation = await seedParticipation(
      worker,
      contest._id,
      (await seedUser(worker))._id,
    );
    const quarter = await seedContestSubmission(
      worker,
      participation,
      problem._id,
      { fields: { result: 'WA', casePoints: 1, caseTotal: 4 }, points: 25 },
    );
    const full = await seedContestSubmission(
      worker,
      participation,
      problem._id,
      { fields: { casePoints: 4, caseTotal: 4 }, points: 100 },
    );
    return { problem, contest, participation, quarter, full };
  };
  /** Rows through the driver: `count` graded submissions with their contest rows, one participation each when `participations` is set. */
  const insertContestRows = async (
    contestId: string,
    problemId: string,
    count: number,
    participations = 1,
  ) => {
    const participationIds = Array.from({ length: participations }, () =>
      toUuid(newId()),
    );
    await worker.db
      .collection<{ _id: UUID }>(worker.participations.collection.name)
      .insertMany(
        participationIds.map((_id) => ({
          _id,
          contest: toUuid(contestId),
          user: toUuid(newId()),
          realStart: new Date(Date.now() - 3_600_000),
          virtual: 0,
          score: 0,
          cumtime: 0,
          tiebreaker: 0,
          frozenScore: 0,
          frozenCumtime: 0,
          frozenTiebreaker: 0,
          formatData: {},
          frozenFormatData: {},
          isDisqualified: false,
          isRegistered: false,
        })),
      );
    const batch = 10_000;
    for (let start = 0; start < count; start += batch) {
      const ids = Array.from({ length: Math.min(batch, count - start) }, () =>
        toUuid(newId()),
      );
      await worker.db
        .collection<{ _id: UUID }>(worker.submissions.collection.name)
        .insertMany(
          ids.map((_id) => ({
            _id,
            user: toUuid(newId()),
            problem: toUuid(problemId),
            language: toUuid(newId()),
            status: 'D',
            result: 'WA',
            points: 0,
            casePoints: 1,
            caseTotal: 4,
            date: new Date(),
            contest: toUuid(contestId),
          })),
        );
      await worker.db
        .collection<{ _id: UUID }>(worker.contestSubmissions.collection.name)
        .insertMany(
          ids.map((_id, index) => ({
            _id,
            participation: participationIds[(start + index) % participations],
            contest: toUuid(contestId),
            problem: toUuid(problemId),
            points: 0,
            isPretest: false,
          })),
        );
    }
  };

  beforeAll(async () => {
    worker = await setupWorkerTest();
    rescores = worker.module.get(ContestRescoreService);
  });
  afterAll(() => worker.teardown());

  it('rescores every contest submission from its case totals and every participation, then writes nothing the second time', async () => {
    const { contest, participation, quarter, full } = await contestWith();
    await worker.contests.updateOne(
      { _id: contest._id },
      { 'problems.0.points': 200 },
    );
    expect(await rescores.rescore(contest._id)).toEqual({
      rescored: 2,
      participations: 1,
    });
    expect([await pointsOf(quarter._id), await pointsOf(full._id)]).toEqual([
      50, 200,
    ]);
    expect((await participationOf(participation._id)).score).toBe(200);
    expect(await rescores.rescore(contest._id)).toEqual({
      rescored: 0,
      participations: 1,
    });
  });

  it('keeps disqualified participations at -9999', async () => {
    const { contest, participation } = await contestWith();
    await worker.participations.updateOne(
      { _id: participation._id },
      { isDisqualified: true },
    );
    await rescores.rescore(contest._id);
    expect((await participationOf(participation._id)).score).toBe(-9999);
  });

  it('consumes queued rescores', async () => {
    const { contest, participation } = await contestWith({
      pointsPrecision: 0,
    });
    await worker.contests.updateOne(
      { _id: contest._id },
      { 'problems.0.points': 30 },
    );
    await enqueueContestRescore(queueOf(), contest._id);
    await waitUntil(
      async () => (await participationOf(participation._id)).score === 30,
    );
  });

  it('an edit made during a running rescore wins', async () => {
    const { contest, participation, full } = await contestWith({
      pointsPrecision: 0,
    });
    // The second edit lands inside the first run and queues its own job: a dropped (deduplicated) one leaves 30.
    const rescore = rescores.rescore.bind(rescores);
    const spy = jest
      .spyOn(rescores, 'rescore')
      .mockImplementationOnce(async (contestId) => {
        const result = await rescore(contestId);
        await worker.contests.updateOne(
          { _id: contestId },
          { 'problems.0.points': 70 },
        );
        await enqueueContestRescore(queueOf(), contestId);
        return result;
      });
    try {
      await worker.contests.updateOne(
        { _id: contest._id },
        { 'problems.0.points': 30 },
      );
      await enqueueContestRescore(queueOf(), contest._id);
      await waitUntil(() => spy.mock.calls.length === 2);
      await waitUntil(drained);
    } finally {
      spy.mockRestore();
    }
    expect(await pointsOf(full._id)).toBe(70);
    expect((await participationOf(participation._id)).score).toBe(70);
  });

  it('reads a contest of thousands of submissions through its index, a chunk at a time', async () => {
    const { contest, problem } = await contestWith();
    const other = await contestWith();
    await insertContestRows(contest._id, problem._id, 5000);
    await insertContestRows(other.contest._id, problem._id, 3000);
    let result: { rescored: number } | undefined;
    const operations = await profileQueries(worker.db, async () => {
      result = await rescores.rescore(contest._id);
    });
    const reads = operations.filter(
      ({ collection, operation }) =>
        [
          worker.contestSubmissions.collection.name,
          worker.submissions.collection.name,
        ].includes(collection) && ['query', 'getmore'].includes(operation),
    );
    expect(reads.length).toBeGreaterThan(0);
    expect(
      reads.every(({ planSummary }) => !planSummary.includes('COLLSCAN')),
    ).toBe(true);
    // The other contest's 3000 rows are never read: apart from the participation recompute's aggregate (its own index), each collection examines at most this contest's 5002 rows.
    for (const name of [
      worker.contestSubmissions.collection.name,
      worker.submissions.collection.name,
    ])
      expect(
        reads
          .filter(
            ({ collection, planSummary }) =>
              collection === name && !planSummary.includes('participation'),
          )
          .reduce((sum, { docsExamined }) => sum + docsExamined, 0),
      ).toBeLessThanOrEqual(5002);
    expect(result!.rescored).toBe(5000);
  }, 60_000);

  it('streams thousands of participations and contest submissions in chunks of at most 1000', async () => {
    const { contest, problem } = await contestWith();
    await insertContestRows(contest._id, problem._id, 12_000, 3000);
    const repository = worker.module.get(ContestRescoreRepository);
    const chunkSizes: number[] = [];
    const recordChunks = <Chunk extends unknown[]>(
      chunks: (contestId: string) => AsyncGenerator<Chunk>,
    ) =>
      async function* (contestId: string) {
        for await (const chunk of chunks(contestId)) {
          chunkSizes.push(chunk.length);
          yield chunk;
        }
      };
    const submissionChunks = recordChunks(
      repository.submissionChunks.bind(repository),
    );
    const participationChunks = recordChunks(
      repository.participationChunks.bind(repository),
    );
    jest
      .spyOn(repository, 'submissionChunks')
      .mockImplementation(submissionChunks);
    jest
      .spyOn(repository, 'participationChunks')
      .mockImplementation(participationChunks);
    try {
      expect(await rescores.rescore(contest._id)).toEqual({
        rescored: 12_000,
        participations: 3001,
      });
    } finally {
      jest.restoreAllMocks();
    }
    expect(Math.max(...chunkSizes)).toBeLessThanOrEqual(1000);
    expect(
      await worker.contestSubmissions.countDocuments({
        contest: contest._id,
        points: 25,
      }),
    ).toBe(12_001);
  }, 600_000);

  it('keeps the points of a regrade that lands between the rescore reading a row and writing it', async () => {
    const { contest, participation, quarter } = await contestWith();
    await worker.contests.updateOne(
      { _id: contest._id },
      { 'problems.0.points': 200 },
    );
    const results = worker.module.get(ContestResultsRepository);
    const caseTotals = results.caseTotals.bind(results);
    const spy = jest
      .spyOn(results, 'caseTotals')
      .mockImplementationOnce(async (ids) => {
        const totals = await caseTotals(ids);
        await worker.contestSubmissions.updateOne(
          { _id: quarter._id },
          { points: 150 },
        );
        return totals;
      });
    try {
      await rescores.rescore(contest._id);
    } finally {
      spy.mockRestore();
    }
    expect(await pointsOf(quarter._id)).toBe(150);
    // The regrade's own recompute settles the participation; the next rescore corrects the row.
    expect((await rescores.rescore(contest._id)).rescored).toBe(1);
    expect(await pointsOf(quarter._id)).toBe(50);
    expect((await participationOf(participation._id)).score).toBe(200);
  });

  it('follows a problem rescore into the contests that list the problem', async () => {
    const { problem, participation, quarter } = await contestWith();
    const elsewhere = await contestWith();
    await worker.problems.updateOne({ _id: problem._id }, { partial: false });
    await worker.module.get(ProblemRescoreService).rescore(problem._id);
    // The participation starts unscored: 100 means the queued contest rescore ran after the points changed.
    await waitUntil(
      async () =>
        (await pointsOf(quarter._id)) === 0 &&
        (await participationOf(participation._id)).score === 100,
    );
    expect(await pointsOf(elsewhere.quarter._id)).toBe(25);
  });

  it('retries a problem rescore whose contest rescore could not be queued, and the retry queues it', async () => {
    const { problem, participation } = await contestWith();
    const problemQueue = worker.module.get<Queue>(
      getQueueToken(PROBLEM_RESCORE_QUEUE),
    );
    // eslint-disable-next-line @typescript-eslint/unbound-method -- re-applied with the queue as `this`
    const add = Queue.prototype.add;
    let failed = false;
    const spy = jest.spyOn(Queue.prototype, 'add').mockImplementation(function (
      this: Queue,
      ...args
    ) {
      if (this.name === CONTEST_RESCORE_QUEUE && !failed) {
        failed = true;
        return Promise.reject(new Error('redis down'));
      }
      return add.apply(this, args);
    });
    try {
      await worker.problems.updateOne({ _id: problem._id }, { partial: false });
      await enqueueRescore(problemQueue, problem._id);
      await waitUntil(async () => (await problemQueue.getDelayedCount()) === 1);
      expect((await participationOf(participation._id)).score).toBe(0);
      const [retry] = await problemQueue.getJobs(['delayed']);
      await retry.promote();
      await waitUntil(
        async () => (await participationOf(participation._id)).score === 100,
      );
    } finally {
      spy.mockRestore();
    }
  });
  describe('replay rebuild request', () => {
    const endedContest = () =>
      contestWith({
        startTime: new Date(Date.now() - 6 * 3_600_000),
        endTime: new Date(Date.now() - 3_600_000),
      });
    /** Spies on the replay queue's adds; every add still reaches Redis unless `fail` is set. */
    const spyReplayAdds = (fail = false) => {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- re-applied with the queue as `this`
      const add = Queue.prototype.add;
      const requested: { name: string; data: unknown; delay?: number }[] = [];
      const spy = jest
        .spyOn(Queue.prototype, 'add')
        .mockImplementation(function (this: Queue, ...args) {
          if (this.name !== CONTEST_REPLAY_QUEUE) return add.apply(this, args);
          const options = args[2];
          requested.push({
            name: args[0] as string,
            data: args[1] as unknown,
            delay: options?.delay,
          });
          return fail
            ? Promise.reject(new Error('redis down'))
            : add.apply(this, args);
        });
      return { requested, spy };
    };

    it('requests one replay build for the contest when its rescore finishes', async () => {
      const { contest } = await endedContest();
      const { requested, spy } = spyReplayAdds();
      try {
        await rescores.rescore(contest._id);
      } finally {
        spy.mockRestore();
      }
      expect(requested).toEqual([
        {
          name: CONTEST_REPLAY_JOB,
          data: { contestId: contest._id },
          delay: 0,
        },
      ]);
    });

    it('delays the build until the judge has settled when the rescore runs just after the end', async () => {
      const minute = 60_000;
      const { contest } = await contestWith({
        startTime: new Date(Date.now() - 3 * 3_600_000),
        endTime: new Date(Date.now() - 2 * minute),
      });
      const { requested, spy } = spyReplayAdds();
      try {
        await rescores.rescore(contest._id);
      } finally {
        spy.mockRestore();
      }
      const [build] = requested;
      expect(build.name).toBe(CONTEST_REPLAY_JOB);
      // Settle is 10 minutes after the end; 2 minutes have passed, so about 8 minutes remain.
      expect(build.delay).toBeGreaterThan(7 * minute);
      expect(build.delay).toBeLessThanOrEqual(8 * minute);
    });

    it('still completes the rescore, and logs the failure, when the replay request cannot be queued', async () => {
      const { contest } = await contestWith();
      const logged = jest.spyOn(Logger.prototype, 'error');
      const { spy } = spyReplayAdds(true);
      try {
        await expect(rescores.rescore(contest._id)).resolves.toMatchObject({
          participations: 1,
        });
        expect(logged).toHaveBeenCalledWith(
          expect.stringContaining(contest._id),
        );
      } finally {
        spy.mockRestore();
        logged.mockRestore();
      }
    });
  });

  describe('contest rating follow-up', () => {
    const endedRatedContest = () =>
      contestWith({
        isRated: true,
        startTime: new Date(Date.now() - 3 * 3_600_000),
        endTime: new Date(Date.now() - 3_600_000),
        pointsPrecision: 0,
      });
    const ratingRows = async (contestId: string) =>
      worker.ratings.find({ contest: contestId }).lean();

    it('re-rates a contest that has ratings once its rescore finished', async () => {
      const { contest, participation } = await endedRatedContest();
      await worker.ratings.create({
        user: participation.user,
        contest: contest._id,
        participation: participation._id,
        contestEndTime: contest.endTime,
        rank: 1,
        rating: 9999,
        mean: 9999,
        performance: 9999,
        lastRated: new Date(),
      });
      await rescores.rescore(contest._id);
      await waitUntil(async () => {
        const rows = await ratingRows(contest._id);
        return rows.length === 1 && rows[0].rating !== 9999;
      });
    });

    it('queues no rating for a contest without ratings', async () => {
      const { contest } = await endedRatedContest();
      // eslint-disable-next-line @typescript-eslint/unbound-method -- re-applied with the queue as `this`
      const add = Queue.prototype.add;
      const queued: string[] = [];
      const spy = jest
        .spyOn(Queue.prototype, 'add')
        .mockImplementation(function (this: Queue, ...args) {
          queued.push(this.name);
          return add.apply(this, args);
        });
      try {
        await rescores.rescore(contest._id);
      } finally {
        spy.mockRestore();
      }
      expect(queued).not.toContain(CONTEST_RATING_QUEUE);
      expect(await ratingRows(contest._id)).toEqual([]);
    });
  });
});
