import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { waitUntil } from '@libs/common/testing';
import { CONTEST_RESCORE_QUEUE, enqueueContestRescore } from '@libs/contests';
import type { ContestRescoreJob } from '@libs/contests';
import { newId, toUuid } from '@libs/database';
import { profileQueries } from '@libs/database/testing';
import type { UUID } from 'mongodb';
import { ContestRescoreRepository } from '../src/jobs/contest-rescore/contest-rescore.repository';
import { ContestRescoreService } from '../src/jobs/contest-rescore/contest-rescore.service';
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
      { result: 'WA', casePoints: 1, caseTotal: 4 },
      25,
    );
    const full = await seedContestSubmission(
      worker,
      participation,
      problem._id,
      { casePoints: 4, caseTotal: 4 },
      100,
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
    // The other contest's 3000 rows are never read: each collection examines at most this contest's 5002 rows twice: once by the rescore's cursor, once by the participation recompute.
    for (const name of [
      worker.contestSubmissions.collection.name,
      worker.submissions.collection.name,
    ])
      expect(
        reads
          .filter(({ collection }) => collection === name)
          .reduce((sum, { docsExamined }) => sum + docsExamined, 0),
      ).toBeLessThanOrEqual(2 * 5002);
    expect(result!.rescored).toBe(5000);
  }, 60_000);

  it('streams 12k participations and 50k contest submissions in chunks of at most 1000', async () => {
    const { contest, problem } = await contestWith();
    await insertContestRows(contest._id, problem._id, 50_000, 12_000);
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
    const started = Date.now();
    try {
      expect(await rescores.rescore(contest._id)).toEqual({
        rescored: 50_000,
        participations: 12_001,
      });
    } finally {
      jest.restoreAllMocks();
    }
    console.log(
      `contest rescore of 12k participations / 50k submissions: ${Date.now() - started} ms`,
    );
    expect(Math.max(...chunkSizes)).toBeLessThanOrEqual(1000);
    expect(
      await worker.contestSubmissions.countDocuments({
        contest: contest._id,
        points: 25,
      }),
    ).toBe(50_001);
  }, 600_000);

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

  it('queues the contest rescores only after the problem is rescored, and fails the job when one cannot be queued', async () => {
    const { problem, quarter } = await contestWith();
    const add = jest
      .spyOn(Queue.prototype, 'add')
      .mockRejectedValueOnce(new Error('redis down'));
    try {
      await worker.problems.updateOne({ _id: problem._id }, { points: 2000 });
      await expect(
        worker.module.get(ProblemRescoreService).rescore(problem._id),
      ).rejects.toThrow('redis down');
    } finally {
      add.mockRestore();
    }
    // The problem's own rescore is committed; the job's retry re-enqueues.
    expect((await worker.problems.findById(problem._id).lean())!.points).toBe(
      2000,
    );
    expect(await pointsOf(quarter._id)).toBe(25);
  });
});
