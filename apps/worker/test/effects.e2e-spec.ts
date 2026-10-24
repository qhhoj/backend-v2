import type Redis from 'ioredis';
import { REDIS } from '@libs/common';
import { CONTEST_RATING_QUEUE, rankingCacheKeys } from '@libs/contests';
import type { ContestRatingJob } from '@libs/contests';
import { newId, OrganizationJudgingCharge, toUuid } from '@libs/database';
import type { Submission } from '@libs/database';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
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
  insertGradedRows,
  seedGraded,
  seedOrganization,
  problemFields,
} from './effects-fixtures';
import { setupWorkerTest } from './setup';
import type { WorkerTest } from './setup';
import { getQueueToken } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Worker } from 'bullmq';
import type { Queue } from 'bullmq';
import { TEST_REDIS_URL, waitUntil } from '@libs/common/testing';
import {
  EFFECTS_SWEEP_JOB,
  EFFECTS_SWEEP_QUEUE,
  gradedJobOf,
  SUBMISSION_GRADED_JOB,
  SUBMISSION_GRADED_QUEUE,
  enqueueGraded,
} from '@libs/judging';
import { EffectsSweepProcessor } from '../src/jobs/effects-sweep/effects-sweep.processor';
import {
  EffectsSweepService,
  SWEEP_WATERMARK_KEY,
} from '../src/jobs/effects-sweep/effects-sweep.service';
import type { SubmissionGradedJob } from '@libs/judging';

let worker: WorkerTest;

beforeAll(async () => {
  worker = await setupWorkerTest();
});
afterAll(() => worker.teardown());

// from contest-effects.e2e-spec.ts
{
  const CONTEST_PROBLEM_DEFAULTS = {
    isPretested: false,
    outputPrefixOverride: null,
    maxSubmissions: null,
  };

  describe('contest effects', () => {
    beforeAll(() => worker.reset());
    let effects: SubmissionEffectsService;
    const apply = (submission: {
      _id: string;
      user: string;
      problem: string;
    }) =>
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

    beforeAll(() => {
      effects = worker.module.get(SubmissionEffectsService);
    });

    it('rescales a graded contest submission to the contest points and rescores its participation', async () => {
      const { problem, participation } = await contestOn({});
      const submission = await seedContestSubmission(
        worker,
        participation,
        problem._id,
        { fields: { result: 'WA', casePoints: 1, caseTotal: 4, points: 250 } },
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
        await seedContestSubmission(
          worker,
          ioi.participation,
          ioi.problem._id,
          {
            fields: {
              result: 'WA',
              casePoints: 3,
              caseTotal: 4,
            },
          },
        ),
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
      expect(
        (await participationOf(participation._id)).cumtime,
      ).toBeGreaterThan(0);
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
        { fields: { result: 'WA', casePoints: 1, caseTotal: 4 } },
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
      {
        name: 'a non-partial contest problem',
        problemFields: {},
        contestFields: {},
        entry: { partial: false },
        points: 0,
      },
      {
        name: 'a non-partial problem',
        problemFields: { partial: false },
        contestFields: {},
        entry: {},
        points: 0,
      },
      {
        name: 'an FSO contest, always partial',
        problemFields: { partial: false },
        contestFields: { formatName: 'final_submission' },
        entry: { partial: false },
        points: 25,
      },
    ])(
      'scores a quarter of the cases on $name as $points',
      async ({ problemFields, contestFields, entry, points }) => {
        const { problem, participation } = await contestOn(
          problemFields,
          contestFields,
          entry,
        );
        const submission = await seedContestSubmission(
          worker,
          participation,
          problem._id,
          { fields: { result: 'WA', casePoints: 1, caseTotal: 4 } },
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
      await seedContestSubmission(worker, participation, problem._id, {
        points: 100,
      });
      await worker.contests.updateOne(
        { _id: contest._id },
        {
          problems: [
            { problem: kept._id, points: 100, partial: true, order: 0 },
          ],
        },
      );
      await apply(await seedContestSubmission(worker, participation, kept._id));
      expect((await participationOf(participation._id)).score).toBe(100);
      expect(
        Object.keys((await participationOf(participation._id)).formatData),
      ).toEqual([kept._id]);
    });

    it('re-rates an ended contest that has ratings once a burst of verdict changes settles', async () => {
      const ratingQueue = worker.module.get<Queue<ContestRatingJob>>(
        getQueueToken(CONTEST_RATING_QUEUE),
      );
      const { problem, contest, participation } = await contestOn(
        {},
        {
          isRated: true,
          isVisible: true,
          startTime: new Date(Date.now() - 3 * 3_600_000),
          endTime: new Date(Date.now() - 3_600_000),
        },
      );
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
      const rejudged = await Promise.all(
        [1, 2, 3].map(() =>
          seedContestSubmission(worker, participation, problem._id),
        ),
      );
      await Promise.all(rejudged.map((submission) => apply(submission)));
      const queued = await ratingQueue.getDelayed();
      expect(queued.map((job) => job.data)).toEqual([
        { contestId: contest._id },
      ]);
      await queued[0].promote();
      await waitUntil(async () =>
        (await worker.ratings.find({ contest: contest._id }).lean()).some(
          (row) => row.rating !== 9999,
        ),
      );
      // The finished run releases the contest: a later verdict change queues the next re-rate.
      await waitUntil(async () => (await ratingQueue.getActiveCount()) === 0);
      await apply(rejudged[0]);
      expect(await ratingQueue.getDelayedCount()).toBe(1);
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
          fields: {
            cases: [
              { position: 1, status: 'AC', points: 30, total: 30, batch: 1 },
              { position: 2, status: 'WA', points: 0, total: 20, batch: null },
            ] as never,
          },
        },
      );
      await apply(submission);
      // Batch 1 full (30 of 50 data points) × 100 / 50.
      expect((await participationOf(participation._id)).score).toBe(60);
    });

    it.each(['AB', 'IE'] as const)(
      'gives no ioi16 batch credit from a %s run whose batch never finished',
      async (verdict) => {
        // Batch 1 = cases 1-2 (30 points), plain case 3 (20 points).
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
        // The run stopped after case 1 (first case of batch 1): case 2 never ran.
        const submission = await seedContestSubmission(
          worker,
          participation,
          problem._id,
          {
            fields: {
              status: verdict,
              result: verdict,
              points: 0,
              cases: [
                { position: 1, status: 'AC', points: 30, total: 30, batch: 1 },
              ] as never,
            },
          },
        );
        await apply(submission);
        expect((await participationOf(participation._id)).score).toBe(0);
      },
    );

    it('keeps the effects stamp of a job that left its participation to another owner, so the sweep can redo it', async () => {
      const { problem, participation } = await contestOn({});
      const submission = await seedContestSubmission(
        worker,
        participation,
        problem._id,
        {
          fields: {
            result: 'AC',
            casePoints: 4,
            caseTotal: 4,
            effectsDueAt: new Date(),
          },
        },
      );
      const dueOf = async () =>
        (await worker.submissions.findById(submission._id).lean())!
          .effectsDueAt;
      const redis = worker.module.get<Redis>(REDIS);
      const ownerLock = `effects:participation:${participation._id}:lock`;
      // Another worker is recomputing the participation; it may still die before reading this row.
      await redis.set(ownerLock, 'other-owner', 'EX', 60);
      await apply(submission);
      expect(await dueOf()).toEqual(expect.any(Date));
      await redis.del(ownerLock);
      await apply(submission);
      expect(await dueOf()).toBeNull();
      expect((await participationOf(participation._id)).score).toBe(100);
    });

    it('collapses 50 graded jobs of one participation into a few recomputes', async () => {
      const { problem, participation } = await contestOn({});
      const submissions = [];
      for (let index = 0; index < 50; index += 1)
        submissions.push(
          await seedContestSubmission(worker, participation, problem._id, {
            fields: {
              result: 'WA',
              casePoints: index % 5,
              caseTotal: 4,
            },
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
}

// from effects-sweep.e2e-spec.ts
{
  const MINUTE = 60_000;
  const sleep = (milliseconds: number) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds));

  describe('effects sweep', () => {
    beforeAll(() => worker.reset());
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
        const { active, waiting } = await queue.getJobCounts(
          'active',
          'waiting',
        );
        return active + waiting === 0;
      });

    beforeAll(() => {
      sweeps = worker.module.get(EffectsSweepService);
      redis = worker.module.get<Redis>(REDIS);
      queue = worker.module.get<Queue>(getQueueToken(EFFECTS_SWEEP_QUEUE));
    });

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
      expect(
        Number(await redis.get(SWEEP_WATERMARK_KEY)),
      ).toBeGreaterThanOrEqual(started);
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

    it('re-applies a finished row whose graded job was lost, contest results included, whatever its dates', async () => {
      const now = Date.now();
      await redis.set(SWEEP_WATERMARK_KEY, String(now - MINUTE));
      const problem = await seedProblem(worker);
      const contest = await seedContest(worker, {
        formatName: 'ioi',
        problems: [
          {
            problem: problem._id,
            points: 100,
            partial: true,
            isPretested: false,
            outputPrefixOverride: null,
            maxSubmissions: null,
            order: 0,
          },
        ],
      });
      const seedEntrant = async (effectsDueAt: Date) => {
        const user = await seedUser(worker);
        const participation = await seedParticipation(
          worker,
          contest._id,
          user._id,
        );
        // a rejudge that ended without grading-begin long after the submit: neither window date is recent
        const old = new Date(now - 3 * 60 * MINUTE);
        const submission = await seedContestSubmission(
          worker,
          participation,
          problem._id,
          { fields: { date: old, judgedDate: null, effectsDueAt } },
        );
        return { user, participation, submission };
      };
      const lost = await seedEntrant(new Date(now - 5 * MINUTE));
      const inFlight = await seedEntrant(new Date(now - 10_000));
      const rowsOf = async ({
        user,
        participation,
        submission,
      }: typeof lost) => ({
        userPoints: (await worker.users.findById(user._id).lean())!.points,
        score: (await worker.participations.findById(participation._id).lean())!
          .score,
        contestPoints: (await worker.contestSubmissions
          .findById(submission._id)
          .lean())!.points,
        effectsDueAt: (await worker.submissions
          .findById(submission._id, { effectsDueAt: 1 })
          .lean())!.effectsDueAt,
      });

      const result = await sweeps.sweep(now);
      expect(result.repaired).toBeGreaterThanOrEqual(1);
      expect(await rowsOf(lost)).toEqual({
        userPoints: 1000,
        score: 100,
        contestPoints: 100,
        effectsDueAt: null,
      });
      // its graded job may still be on the way: left to it
      expect(await rowsOf(inFlight)).toMatchObject({
        score: 0,
        contestPoints: 0,
        effectsDueAt: expect.any(Date) as Date,
      });
    });

    it('waits for graded jobs still queued (a backlog), and puts a row that keeps failing behind the others', async () => {
      const now = Date.now();
      await redis.set(SWEEP_WATERMARK_KEY, String(now - MINUTE));
      const problem = await seedProblem(worker);
      const dueRow = async (minutesAgo: number) => {
        const user = await seedUser(worker);
        const submission = await seedGraded(worker, user._id, problem._id, {
          date: new Date(now - 3 * 60 * MINUTE),
          judgedDate: null,
          effectsDueAt: new Date(now - minutesAgo * MINUTE),
        });
        return { user, submission };
      };
      const dueOf = async (id: string) =>
        (await worker.submissions.findById(id, { effectsDueAt: 1 }).lean())!
          .effectsDueAt;
      const graded = worker.module.get<Queue>(
        getQueueToken(SUBMISSION_GRADED_QUEUE),
      );
      const failing = await dueRow(40);
      const queuedBehind = await dueRow(20);
      await graded.pause();
      try {
        // a job queued 30 minutes ago still waits: rows stamped after it may be behind it
        await graded.add(
          SUBMISSION_GRADED_JOB,
          gradedJobOf(failing.submission),
          {
            timestamp: now - 30 * MINUTE,
          },
        );
        const effects = worker.module.get(SubmissionEffectsService);
        const apply = effects.apply.bind(effects);
        const broken = jest
          .spyOn(effects, 'apply')
          .mockImplementation((job) =>
            job.submissionId === failing.submission._id
              ? Promise.reject(new Error('scoring threw'))
              : apply(job),
          );
        try {
          await sweeps.sweep(now);
        } finally {
          broken.mockRestore();
        }
        expect(await dueOf(queuedBehind.submission._id)).toEqual(
          new Date(now - 20 * MINUTE),
        );
        // postponed: due from the failed attempt on
        expect(
          (await dueOf(failing.submission._id))!.getTime(),
        ).toBeGreaterThan(now - MINUTE);
        await graded.obliterate({ force: true });
        await sweeps.sweep(now);
        expect(await dueOf(queuedBehind.submission._id)).toBeNull();
        expect(
          (await worker.users.findById(queuedBehind.user._id).lean())!.points,
        ).toBe(1000);
      } finally {
        await graded.resume();
      }
    });

    it('logs a row whose repair keeps failing once per backoff, not on every sweep', async () => {
      const now = Date.now();
      const problem = await seedProblem(worker);
      const user = await seedUser(worker);
      const stuck = await seedGraded(worker, user._id, problem._id, {
        date: new Date(now - 3 * 60 * MINUTE),
        judgedDate: null,
        effectsDueAt: new Date(now - 40 * MINUTE),
      });
      const effects = worker.module.get(SubmissionEffectsService);
      jest
        .spyOn(effects, 'apply')
        .mockRejectedValue(new Error('scoring threw'));
      const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation();
      const failuresLogged = () =>
        logged.mock.calls.filter((call) => String(call[0]).includes(stuck._id))
          .length;
      try {
        for (const minutes of [0, 10, 20, 30])
          await sweeps.sweep(now + minutes * MINUTE);
        expect(failuresLogged()).toBe(1);
        await sweeps.sweep(now + 70 * MINUTE);
        expect(failuresLogged()).toBe(2);
      } finally {
        jest.restoreAllMocks();
      }
    });

    it('reads its window through indexes', async () => {
      const problem = await seedProblem(worker);
      await insertGradedRows(worker, 2000, () => ({
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
        windowReads.every(
          ({ planSummary }) => !planSummary.includes('COLLSCAN'),
        ),
      ).toBe(true);
      expect(
        windowReads.reduce((sum, { docsExamined }) => sum + docsExamined, 0),
      ).toBeLessThan(2000);
      const dueReads = operations.filter(
        ({ collection, operation, planSummary }) =>
          collection === 'submissions' &&
          operation === 'query' &&
          planSummary !== 'IDHACK',
      );
      expect(dueReads.length).toBeGreaterThan(0);
      expect(
        dueReads.every(
          ({ planSummary, hasSortStage }) =>
            planSummary.includes('IXSCAN { effectsDueAt: 1 }') && !hasSortStage,
        ),
      ).toBe(true);
    });

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
        return { users: 0, problems: 0, repaired: 0 };
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
}

// from submission-effects.e2e-spec.ts
{
  const geometric = (count: number) => (1 - 0.98514 ** count) / (1 - 0.98514);

  describe('submission effects', () => {
    beforeAll(() => worker.reset());
    let effects: SubmissionEffectsService;
    const pointsOf = async (userId: string) =>
      (await worker.users
        .findById(userId, { points: 1, performancePoints: 1, problemCount: 1 })
        .lean())!;
    const statsOf = async (problemId: string) =>
      (await worker.problems
        .findById(problemId, { userCount: 1, acRate: 1 })
        .lean())!;

    beforeAll(() => {
      effects = worker.module.get(SubmissionEffectsService);
    });

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
      expect(recomputed).toMatchObject({
        points: 301 * 800,
        problemCount: 301,
      });
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

    it('retries a failed job after a partial run and lands the same state, with nothing left failed', async () => {
      const queue = worker.module.get<Queue<SubmissionGradedJob>>(
        getQueueToken(SUBMISSION_GRADED_QUEUE),
      );
      const user = await seedUser(worker);
      const problem = await seedProblem(worker, { points: 900 });
      const submission = await seedGraded(worker, user._id, problem._id, {
        points: 900,
      });
      const recomputeUser = effects.recomputeUser.bind(effects);
      // The user is recomputed, then the attempt dies before the problem's stats.
      const failing = jest
        .spyOn(effects, 'recomputeUser')
        .mockImplementationOnce(async (userId) => {
          await recomputeUser(userId);
          throw new Error('mongo hiccup');
        });
      await enqueueGraded(queue, gradedJobOf(submission));
      await waitUntil(async () => (await queue.getDelayed()).length === 1);
      failing.mockRestore();
      const [delayed] = await queue.getDelayed();
      expect(delayed.attemptsMade).toBe(1);
      expect((await statsOf(problem._id)).userCount).toBe(0);
      await delayed.promote();
      await waitUntil(async () => (await statsOf(problem._id)).userCount === 1);
      expect(await statsOf(problem._id)).toMatchObject({ acRate: 100 });
      expect(await pointsOf(user._id)).toMatchObject({
        points: 900,
        problemCount: 1,
      });
      expect(await queue.getFailedCount()).toBe(0);
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

    it('clears the effects stamp it applied, also for a deleted problem, but never a newer one written meanwhile', async () => {
      const dueOf = async (id: string) =>
        (await worker.submissions.findById(id, { effectsDueAt: 1 }).lean())!
          .effectsDueAt;
      const user = await seedUser(worker);
      const problem = await seedProblem(worker);
      const applied = await seedGraded(worker, user._id, problem._id, {
        effectsDueAt: new Date(),
      });
      await effects.apply(gradedJobOf(applied));
      expect(await dueOf(applied._id)).toBeNull();

      const gone = await seedProblem(worker, { deletedAt: new Date() });
      const orphan = await seedGraded(worker, user._id, gone._id, {
        effectsDueAt: new Date(),
      });
      await effects.apply(gradedJobOf(orphan));
      expect(await dueOf(orphan._id)).toBeNull();

      const rejudged = await seedGraded(worker, user._id, problem._id, {
        effectsDueAt: new Date(Date.now() - 60_000),
      });
      const newer = new Date();
      const recomputeProblem = effects.recomputeProblem.bind(effects);
      // a rejudge finishes while this job's effects run
      const racing = jest
        .spyOn(effects, 'recomputeProblem')
        .mockImplementationOnce(async (problemId) => {
          await worker.submissions.updateOne(
            { _id: rejudged._id },
            { $set: { effectsDueAt: newer } },
          );
          return recomputeProblem(problemId);
        });
      try {
        await effects.apply(gradedJobOf(rejudged));
      } finally {
        racing.mockRestore();
      }
      expect(await dueOf(rejudged._id)).toEqual(newer);
    });

    it('recomputes a user past 300 problems through indexes', async () => {
      const user = await seedUser(worker);
      const solved = await worker.problems.insertMany(
        Array.from({ length: 400 }, () => problemFields({ points: 800 })),
      );
      await insertGradedRows(worker, 2000, (index) => ({
        user: user._id,
        problem: solved[index % 400]._id,
        result: index < 400 ? 'AC' : 'WA',
        points: index < 400 ? 800 : 400,
        casePoints: index < 400 ? 2 : 1,
        caseTotal: 2,
      }));
      await insertGradedRows(worker, 2000, (index) => ({
        user: newId(),
        problem: solved[index % 400]._id,
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
      // A collection scan would read the other users' 2000 rows too.
      expect(
        reads.reduce((sum, { docsExamined }) => sum + docsExamined, 0),
      ).toBeLessThan(4000);
      const recomputed = await pointsOf(user._id);
      expect(recomputed).toMatchObject({
        points: 400 * 800,
        problemCount: 400,
      });
      expect(recomputed.performancePoints).toBeCloseTo(
        800 * geometric(300) + 0.05 * 400,
        6,
      );
    });

    it('recomputes a problem through indexes', async () => {
      const problem = await seedProblem(worker, { points: 1000 });
      const other = await seedProblem(worker);
      const unlisted = await Promise.all(
        Array.from({ length: 10 }, () =>
          seedUser(worker, { isUnlisted: true }),
        ),
      );
      const userIds = [
        ...unlisted.map((user) => user._id),
        ...Array.from({ length: 90 }, newId),
      ];
      const accepted = (index: number) => index % 10 === 0;
      await insertGradedRows(worker, 2000, (index) => ({
        user: userIds[index % 100],
        problem: problem._id,
        result: accepted(index) ? 'AC' : 'WA',
        points: accepted(index) ? 1000 : 0,
        casePoints: accepted(index) ? 1 : 0,
        caseTotal: 1,
      }));
      await insertGradedRows(worker, 2000, () => ({
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
        const reads = operations.filter(
          ({ collection }) => collection === name,
        );
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
      // A collection scan would also read the other problem's 2000 rows.
      expect(examined).toBeLessThan(4000);
      // 1800 rows of listed users, 180 of them AC with full points, from 9 users.
      expect(await statsOf(problem._id)).toMatchObject({
        userCount: 9,
        acRate: 10,
      });
    });
  });
}

{
  describe('judging charges of graded jobs', () => {
    beforeAll(() => worker.reset());
    let effects: SubmissionEffectsService;
    let charges: Model<OrganizationJudgingCharge>;
    const msChargedFor = async (submissionId: string) =>
      (await charges.find({ submission: submissionId }).lean()).map(
        (row) => row.ms,
      );
    /** A graded run of 0.5 s solution and 0.25 s checker on an organization problem. */
    const seedOrganizationRun = async (fields: Partial<Submission> = {}) => {
      const organization = await seedOrganization(worker);
      const problem = await seedProblem(worker, {
        isOrganizationPrivate: true,
        organizations: [organization._id],
      });
      const user = await seedUser(worker);
      return seedGraded(worker, user._id, problem._id, {
        judgeGeneration: 1,
        cases: [
          { position: 1, status: 'AC', time: 0.5, juryTime: 0.25 },
        ] as Submission['cases'],
        ...fields,
      });
    };

    beforeAll(() => {
      effects = worker.module.get(SubmissionEffectsService);
      charges = worker.module.get(
        getModelToken(OrganizationJudgingCharge.name),
      );
    });

    it('charges a queued graded job once, even when the job is applied again', async () => {
      const queue = worker.module.get<Queue<SubmissionGradedJob>>(
        getQueueToken(SUBMISSION_GRADED_QUEUE),
      );
      const submission = await seedOrganizationRun();
      await enqueueGraded(queue, gradedJobOf(submission));
      await waitUntil(
        async () => (await msChargedFor(submission._id)).length > 0,
      );
      await effects.apply(gradedJobOf(submission));
      expect(await msChargedFor(submission._id)).toEqual([750]);
    });

    it('charges a row the sweep repaired once, though its lost job turns up later', async () => {
      const sweeps = worker.module.get(EffectsSweepService);
      const now = Date.now();
      await worker.module
        .get<Redis>(REDIS)
        .set(SWEEP_WATERMARK_KEY, String(now - 60_000));
      const submission = await seedOrganizationRun({
        effectsDueAt: new Date(now - 5 * 60_000),
      });
      expect((await sweeps.sweep(now)).repaired).toBeGreaterThanOrEqual(1);
      await effects.apply(gradedJobOf(submission));
      expect(await msChargedFor(submission._id)).toEqual([750]);
    });

    it('charges a run on a problem deleted meanwhile, whose other effects are skipped', async () => {
      const submission = await seedOrganizationRun();
      await worker.problems.updateOne(
        { _id: submission.problem },
        { $set: { deletedAt: new Date() } },
      );
      await effects.apply(gradedJobOf(submission));
      expect(await msChargedFor(submission._id)).toEqual([750]);
    });
  });
}
