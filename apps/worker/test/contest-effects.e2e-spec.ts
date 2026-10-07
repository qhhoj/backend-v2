import type Redis from 'ioredis';
import { REDIS } from '@libs/common';
import { rankingCacheKeys } from '@libs/contests';
import { newId, toUuid } from '@libs/database';
import { profileQueries } from '@libs/database/testing';
import type { UUID } from 'mongodb';
import { ContestResultsRepository } from '../src/jobs/submission-effects/contest-results.repository';
import { SubmissionEffectsService } from '../src/jobs/submission-effects/submission-effects.service';
import {
  seedContest,
  seedContestSubmission,
  seedParticipation,
  seedProblem,
  seedUser,
} from './effects-fixtures';
import { setupWorkerTest } from './setup';
import type { WorkerTest } from './setup';

const CONTEST_PROBLEM_DEFAULTS = {
  isPretested: false,
  outputPrefixOverride: null,
  maxSubmissions: null,
};

describe('contest effects', () => {
  let worker: WorkerTest;
  let effects: SubmissionEffectsService;
  const apply = (submission: { _id: string; user: string; problem: string }) =>
    effects.apply({
      submissionId: submission._id,
      userId: String(submission.user),
      problemId: String(submission.problem),
    });
  const participationOf = async (id: string) =>
    (await worker.participations.findById(id).lean())!;
  const pointsOf = async (submissionId: string) =>
    (await worker.contestSubmissions.findById(submissionId).lean())!.points;
  const contestOn = async (
    problemFields: object,
    contestFields: object = {},
    entry: object = {},
  ) => {
    const problem = await seedProblem(worker, {
      points: 1000,
      partial: true,
      ...problemFields,
    });
    const contest = await seedContest(worker, {
      problems: [
        {
          problem: problem._id,
          ...CONTEST_PROBLEM_DEFAULTS,
          points: 100,
          partial: true,
          order: 0,
          ...entry,
        },
      ],
      ...contestFields,
    });
    const user = await seedUser(worker);
    const participation = await seedParticipation(
      worker,
      contest._id,
      user._id,
    );
    return { problem, contest, user, participation };
  };

  beforeAll(async () => {
    worker = await setupWorkerTest();
    effects = worker.module.get(SubmissionEffectsService);
  });
  afterAll(() => worker.teardown());

  it('rescales a graded contest submission to the contest points and rescores its participation', async () => {
    const { problem, participation } = await contestOn({});
    const submission = await seedContestSubmission(
      worker,
      participation,
      problem._id,
      { result: 'WA', casePoints: 1, caseTotal: 4, points: 250 },
    );
    await apply(submission);
    expect(await pointsOf(submission._id)).toBe(25);
    const scored = await participationOf(participation._id);
    expect(scored).toMatchObject({ score: 25, frozenScore: 25 });
    expect(scored.formatData).toEqual({
      [problem._id]: { points: 25, time: expect.any(Number) as number },
    });
  });

  it('updates score, cumtime and formatData per format from the same graded submission', async () => {
    const icpc = await contestOn({}, { formatName: 'icpc' });
    const icpcSubmission = await seedContestSubmission(
      worker,
      icpc.participation,
      icpc.problem._id,
    );
    await apply(icpcSubmission);
    const solved = await participationOf(icpc.participation._id);
    expect(solved.score).toBe(100);
    expect(solved.cumtime).toBeGreaterThan(0);
    expect(solved.formatData).toEqual({
      [icpc.problem._id]: expect.objectContaining({
        time: expect.any(Number) as number,
      }) as unknown,
    });

    const ioi = await contestOn({}, { formatName: 'ioi' });
    await apply(
      await seedContestSubmission(worker, ioi.participation, ioi.problem._id, {
        result: 'WA',
        casePoints: 3,
        caseTotal: 4,
      }),
    );
    const scored = await participationOf(ioi.participation._id);
    // Legacy IOI stores no times under the default config.
    expect(scored).toMatchObject({ score: 75, cumtime: 0, tiebreaker: 0 });
    expect(scored.formatData).toEqual({
      [ioi.problem._id]: expect.objectContaining({ points: 75 }) as unknown,
    });
  });

  it('stores ioi cumtime when the contest config asks for it', async () => {
    const { problem, participation } = await contestOn(
      {},
      { formatName: 'ioi', formatConfig: { cumtime: true } },
    );
    await apply(
      await seedContestSubmission(worker, participation, problem._id),
    );
    expect((await participationOf(participation._id)).cumtime).toBeGreaterThan(
      0,
    );
  });

  it('times a virtual participation from its own start, not the contest start', async () => {
    const {
      problem,
      contest,
      participation: live,
    } = await contestOn({}, { formatName: 'icpc' });
    const virtual = await seedParticipation(worker, contest._id, newId(), {
      virtual: 1,
      realStart: new Date(Date.now() - 600_000),
    });
    await apply(await seedContestSubmission(worker, live, problem._id));
    await apply(await seedContestSubmission(worker, virtual, problem._id));
    const timeOf = async (id: string) =>
      (
        (await participationOf(id)).formatData[problem._id] as {
          time: number;
        }
      ).time;
    expect(await timeOf(live._id)).toBeCloseTo(3600, -1);
    expect(await timeOf(virtual._id)).toBeCloseTo(600, -1);
  });

  it('is idempotent: a retried job yields the same results', async () => {
    const { problem, participation } = await contestOn({});
    const submission = await seedContestSubmission(
      worker,
      participation,
      problem._id,
      { result: 'WA', casePoints: 1, caseTotal: 4 },
    );
    await apply(submission);
    const withoutUpdatedAt = async () => ({
      ...(await participationOf(participation._id)),
      updatedAt: undefined,
    });
    const first = await withoutUpdatedAt();
    await apply(submission);
    expect(await withoutUpdatedAt()).toEqual(first);
    expect(await pointsOf(submission._id)).toBe(25);
  });

  it.each([
    ['a non-partial contest problem', {}, {}, { partial: false }, 0],
    ['a non-partial problem', { partial: false }, {}, {}, 0],
    [
      'an FSO contest, always partial',
      { partial: false },
      { formatName: 'final_submission' },
      { partial: false },
      25,
    ],
  ])(
    'scores a quarter of the cases on %s as %p',
    async (_case, problemFields, contestFields, entry, points) => {
      const { problem, participation } = await contestOn(
        problemFields,
        contestFields,
        entry,
      );
      const submission = await seedContestSubmission(
        worker,
        participation,
        problem._id,
        { result: 'WA', casePoints: 1, caseTotal: 4 },
      );
      await apply(submission);
      expect(await pointsOf(submission._id)).toBe(points);
    },
  );

  it('keeps a disqualified participation at -9999', async () => {
    const { problem, participation } = await contestOn({});
    await worker.participations.updateOne(
      { _id: participation._id },
      { isDisqualified: true },
    );
    await apply(
      await seedContestSubmission(worker, participation, problem._id),
    );
    expect(await participationOf(participation._id)).toMatchObject({
      score: -9999,
      cumtime: 0,
      tiebreaker: 0,
      frozenScore: -9999,
    });
  });

  it('purges every ranking cache key of the contest', async () => {
    const { problem, contest, participation } = await contestOn({});
    const redis = worker.module.get<Redis>(REDIS);
    for (const key of rankingCacheKeys(contest._id))
      await redis.set(key, 'stale');
    await apply(
      await seedContestSubmission(worker, participation, problem._id),
    );
    expect(await redis.exists(...rankingCacheKeys(contest._id))).toBe(0);
  });

  it('stops scoring a problem removed from the contest', async () => {
    const { problem, contest, participation } = await contestOn({});
    const kept = await seedProblem(worker, { points: 1000, partial: true });
    await seedContestSubmission(worker, participation, problem._id, {}, 100);
    await worker.contests.updateOne(
      { _id: contest._id },
      {
        problems: [{ problem: kept._id, points: 100, partial: true, order: 0 }],
      },
    );
    await apply(await seedContestSubmission(worker, participation, kept._id));
    expect((await participationOf(participation._id)).score).toBe(100);
    expect(
      Object.keys((await participationOf(participation._id)).formatData),
    ).toEqual([kept._id]);
  });

  it('fills the frozen fields of a frozen icpc contest', async () => {
    const { problem, participation } = await contestOn(
      {},
      { formatName: 'icpc', frozenLastMinutes: 180 },
    );
    await apply(
      await seedContestSubmission(worker, participation, problem._id),
    );
    expect(await participationOf(participation._id)).toMatchObject({
      score: 100,
      frozenScore: 0,
    });
  });

  it('scores ioi16 from the batch minima of the cases and the problem data points', async () => {
    const problem = await seedProblem(worker, {
      points: 1000,
      partial: true,
      data: {
        cases: [
          { type: 'S', points: 30 },
          { type: 'C', points: 0 },
          { type: 'E' },
          { type: 'C', points: 20 },
        ],
      } as never,
    });
    const contest = await seedContest(worker, {
      formatName: 'ioi16',
      problems: [
        {
          ...CONTEST_PROBLEM_DEFAULTS,
          problem: problem._id,
          points: 100,
          partial: true,
          order: 0,
        },
      ],
    });
    const user = await seedUser(worker);
    const participation = await seedParticipation(
      worker,
      contest._id,
      user._id,
    );
    const submission = await seedContestSubmission(
      worker,
      participation,
      problem._id,
      {
        cases: [
          { position: 1, status: 'AC', points: 30, total: 30, batch: 1 },
          { position: 2, status: 'WA', points: 0, total: 20, batch: null },
        ] as never,
      },
    );
    await apply(submission);
    // Batch 1 full (30 of 50 data points) × 100 / 50.
    expect((await participationOf(participation._id)).score).toBe(60);
  });

  it('collapses 50 graded jobs of one participation into a few recomputes', async () => {
    const { problem, participation } = await contestOn({});
    const submissions = [];
    for (let index = 0; index < 50; index += 1)
      submissions.push(
        await seedContestSubmission(worker, participation, problem._id, {
          result: 'WA',
          casePoints: index % 5,
          caseTotal: 4,
        }),
      );
    const reads = jest.spyOn(
      worker.module.get(ContestResultsRepository),
      'scoringRows',
    );
    try {
      await Promise.all(
        submissions.map((submission) => effects.applyContest(submission._id)),
      );
      expect(reads.mock.calls.length).toBeGreaterThanOrEqual(1);
      // Each job reads a few rows before it marks the participation, so marks spread out; still far fewer runs than jobs.
      expect(reads.mock.calls.length).toBeLessThan(25);
      expect((await participationOf(participation._id)).score).toBe(100);
    } finally {
      reads.mockRestore();
    }
  });

  it('recomputes a participation with 2000 contest submissions through indexes', async () => {
    const { problem, contest, participation } = await contestOn({});
    const other = await seedParticipation(worker, contest._id, newId());
    for (const owner of [participation, other]) {
      const rows = Array.from({ length: 2000 }, () => ({
        _id: toUuid(newId()),
      }));
      await worker.db
        .collection<{ _id: UUID }>(worker.submissions.collection.name)
        .insertMany(
          rows.map(({ _id }) => ({
            _id,
            user: toUuid(String(owner.user)),
            problem: toUuid(problem._id),
            language: toUuid(newId()),
            status: 'D',
            result: 'WA',
            points: 0,
            casePoints: 0,
            caseTotal: 1,
            date: new Date(),
            contest: toUuid(contest._id),
          })),
        );
      await worker.db
        .collection<{ _id: UUID }>(worker.contestSubmissions.collection.name)
        .insertMany(
          rows.map(({ _id }) => ({
            _id,
            participation: toUuid(owner._id),
            contest: toUuid(contest._id),
            problem: toUuid(problem._id),
            points: 0,
            isPretest: false,
          })),
        );
    }
    const operations = await profileQueries(worker.db, () =>
      effects.recomputeParticipation(participation._id),
    );
    const reads = operations.filter(
      ({ collection }) =>
        collection === worker.contestSubmissions.collection.name,
    );
    expect(reads.length).toBeGreaterThan(0);
    expect(
      reads.every(({ planSummary }) => !planSummary.includes('COLLSCAN')),
    ).toBe(true);
    // Ruling P5: the aggregate counts its submissions lookups; a collection scan would also read the other participation's rows (more than 2 × 2000).
    expect(
      reads.reduce((sum, { docsExamined }) => sum + docsExamined, 0),
    ).toBeLessThanOrEqual(2 * 2000);
  });
});
