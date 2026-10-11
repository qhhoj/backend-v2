import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { Logger } from '@nestjs/common';
import { REDIS } from '@libs/common';
import { waitUntil } from '@libs/common/testing';
import {
  childPath,
  CONTRIBUTION_POINTS_QUEUE,
  notifyContributionPoints,
  ORGANIZATION_POINTS_JOB,
} from '@libs/community';
import type { ContributionPointsJob } from '@libs/community';
import {
  newId,
  OrganizationCreditEntry,
  OrganizationUsage,
  toUuid,
} from '@libs/database';
import { profileQueries } from '@libs/database/testing';
import { ContributionPointsService } from '../src/jobs/contribution-points/contribution-points.service';
import {
  seedProblem,
  seedUser,
  seedGraded,
  seedOrganization,
} from './effects-fixtures';
import { setupWorkerTest } from './setup';
import type { WorkerTest } from './setup';
import { OrganizationPointsService } from '../src/jobs/organization-points/organization-points.service';
import { SubmissionEffectsService } from '../src/jobs/submission-effects/submission-effects.service';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { OrganizationUsageAuditService } from '../src/jobs/organization-usage-audit/organization-usage-audit.service';
import {
  PROBLEM_SOLVERS_QUEUE,
  PROBLEM_DATABYTES_JOB_ID,
  PROBLEM_DATABYTES_QUEUE,
  ProblemDataFilesService,
  QUOTA_BACKFILL_DONE_KEY,
} from '@libs/problems';
import type { ProblemSolversJob } from '@libs/problems';
import { ProblemSolversService } from '../src/jobs/problem-solvers/problem-solvers.service';
import { softDeleteWorker, undeleteWorker } from './deleted-problem-fixtures';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProblemDataBytesProcessor } from '../src/jobs/problem-databytes/problem-databytes.processor';
import { ProblemDataBytesRepository } from '../src/jobs/problem-databytes/problem-databytes.repository';
import { ProblemDataBytesService } from '../src/jobs/problem-databytes/problem-databytes.service';

let worker: WorkerTest;

beforeAll(async () => {
  worker = await setupWorkerTest();
});
afterAll(() => worker.teardown());

// from contribution-points.e2e-spec.ts
{
  describe('contribution points', () => {
    beforeAll(() => worker.reset());
    let service: ContributionPointsService;
    const pointsOf = async (userId: string) =>
      (await worker.users.findById(userId, { contributionPoints: 1 }).lean())!
        .contributionPoints;
    const comment = (author: string, score: number, hidden = false) => {
      const commentId = newId();
      return worker.comments.create({
        _id: commentId,
        page: { type: 'blog', id: newId() },
        author,
        threadId: commentId,
        path: childPath(null, commentId),
        body: 'x',
        score,
        hidden,
      });
    };
    const post = (authors: string[], score: number, extra: object = {}) =>
      worker.blogPosts.create({
        title: 'P',
        slug: 'p',
        authors,
        publishOn: new Date(),
        content: 'x',
        visible: true,
        score,
        ...extra,
      });

    beforeAll(() => {
      service = worker.module.get(ContributionPointsService);
    });

    it('sums visible comments, visible personal posts and public suggestions', async () => {
      const user = await seedUser(worker);
      const other = await seedUser(worker);
      await comment(user._id, 3);
      await comment(user._id, 10, true);
      await comment(other._id, 5);
      await post([user._id, other._id], 2);
      await post([user._id], 7, { organization: newId() });
      await post([user._id], 4, { visible: false });
      await seedProblem(worker, { suggester: user._id, isPublic: true });
      await seedProblem(worker, { suggester: user._id, isPublic: false });
      const operations = await profileQueries(worker.db, () =>
        service.recompute(user._id),
      );
      // 3 (comment) + 2 (post) + 20 (one public suggestion)
      expect(await pointsOf(user._id)).toBe(25);
      const reads = operations.filter(({ collection }) =>
        ['comments', 'blogPosts', 'problems'].includes(collection),
      );
      expect(reads.length).toBeGreaterThanOrEqual(3);
      expect(
        reads.every(({ planSummary }) => !planSummary.includes('COLLSCAN')),
      ).toBe(true);
    });

    it('adds 10 points per good ticket and ignores ordinary ones', async () => {
      const user = await seedUser(worker);
      await worker.tickets.create({
        title: 'A',
        user: user._id,
        linkedItem: { type: 'general', id: newId() },
        isContributive: true,
      });
      await worker.tickets.create({
        title: 'B',
        user: user._id,
        linkedItem: { type: 'general', id: newId() },
        isContributive: true,
      });
      await worker.tickets.create({
        title: 'C',
        user: user._id,
        linkedItem: { type: 'general', id: newId() },
      });
      const operations = await profileQueries(worker.db, () =>
        service.recompute(user._id),
      );
      expect(await pointsOf(user._id)).toBe(20);
      await worker.tickets.updateOne(
        { user: user._id, title: 'A' },
        { isContributive: false },
      );
      await service.recompute(user._id);
      expect(await pointsOf(user._id)).toBe(10);
      const reads = operations.filter(
        ({ collection }) => collection === 'tickets',
      );
      expect(reads.length).toBeGreaterThanOrEqual(1);
      expect(
        reads.every(({ planSummary }) => !planSummary.includes('COLLSCAN')),
      ).toBe(true);
    });

    it('recomputes through the queue', async () => {
      const user = await seedUser(worker, { contributionPoints: 99 });
      await comment(user._id, -2);
      const queue = worker.module.get<Queue<ContributionPointsJob>>(
        getQueueToken(CONTRIBUTION_POINTS_QUEUE),
      );
      await notifyContributionPoints(
        queue,
        worker.module.get<Redis>(REDIS),
        [user._id],
        new Logger('test'),
      );
      await waitUntil(async () => (await pointsOf(user._id)) === -2);
    });
  });
}

// from organization-points.e2e-spec.ts
{
  describe('organization points', () => {
    beforeAll(() => worker.reset());
    let service: OrganizationPointsService;
    let effects: SubmissionEffectsService;
    const stored = async (organizationId: string) =>
      (await worker.organizations
        .findById(organizationId, { performancePoints: 1, memberCount: 1 })
        .lean())!;

    beforeAll(() => {
      service = worker.module.get(OrganizationPointsService);
      effects = worker.module.get(SubmissionEffectsService);
    });

    it('sums 0.95^i × pp over members with pp > 0 and counts every member', async () => {
      const organization = await seedOrganization(worker);
      await seedUser(worker, {
        organizations: [organization._id],
        performancePoints: 50,
      });
      await seedUser(worker, {
        organizations: [organization._id],
        performancePoints: 100,
      });
      await seedUser(worker, {
        organizations: [organization._id],
        performancePoints: 0,
      });
      await seedUser(worker, {
        organizations: [organization._id],
        performancePoints: 10,
        isUnlisted: true,
      });
      await seedUser(worker, { performancePoints: 1000 });
      await service.recompute(organization._id);
      const { performancePoints, memberCount } = await stored(organization._id);
      expect(performancePoints).toBeCloseTo(
        100 + 0.95 * 50 + 0.95 ** 2 * 10,
        9,
      );
      expect(memberCount).toBe(4);
    });

    it('weighs only the top 100 members and reads them through the members index', async () => {
      const organization = await seedOrganization(worker);
      await worker.users.insertMany(
        Array.from({ length: 150 }, (_unused, index) => ({
          username: `org_pp_${index}`,
          password: '!',
          isActive: true,
          organizations: [organization._id],
          performancePoints: 1,
        })),
      );
      const operations = await profileQueries(worker.db, () =>
        service.recompute(organization._id),
      );
      expect((await stored(organization._id)).performancePoints).toBeCloseTo(
        (1 - 0.95 ** 100) / 0.05,
        9,
      );
      expect((await stored(organization._id)).memberCount).toBe(150);
      const userReads = operations.filter(
        ({ collection }) => collection === 'users',
      );
      expect(userReads.length).toBeGreaterThan(0);
      expect(
        userReads.every(({ planSummary }) => !planSummary.includes('COLLSCAN')),
      ).toBe(true);
    });

    it('queues the member organizations when a graded submission changes the PP, and nothing when it does not', async () => {
      const [first, second] = [
        await seedOrganization(worker),
        await seedOrganization(worker),
      ];
      const member = await seedUser(worker, {
        organizations: [first._id, second._id],
      });
      const problem = await seedProblem(worker);
      const submission = await seedGraded(worker, member._id, problem._id);
      const job = {
        submissionId: submission._id,
        userId: member._id,
        problemId: problem._id,
      };
      // The queue is registered in two modules, so spy on the prototype and keep only this job's calls.
      const added = jest.spyOn(Queue.prototype, 'addBulk');
      const queuedOrganizations = () =>
        added.mock.calls
          .flatMap(([jobs]) => jobs)
          .filter(({ name }) => name === ORGANIZATION_POINTS_JOB)
          .map(
            ({ data }) => (data as { organizationId: string }).organizationId,
          );
      try {
        await effects.apply(job);
        expect(queuedOrganizations().sort()).toEqual(
          [first._id, second._id].sort(),
        );
        await waitUntil(
          async () => (await stored(first._id)).performancePoints > 0,
        );
        expect((await stored(first._id)).performancePoints).toBeCloseTo(
          1000 + 0.05,
          9,
        );
        await waitUntil(
          async () => (await stored(second._id)).memberCount === 1,
        );
        added.mockClear();
        await effects.apply(job);
        expect(queuedOrganizations()).toEqual([]);
      } finally {
        added.mockRestore();
      }
    });

    it('clears the pending flag when a recompute starts, so a later change queues another', async () => {
      const organization = await seedOrganization(worker);
      const redis = worker.module.get<Redis>(REDIS);
      const flag = `organization-points:pending:${organization._id}`;
      await redis.set(flag, '1');
      await service.recompute(organization._id);
      expect(await redis.exists(flag)).toBe(0);
    });

    it('leaves a deleted organization alone', async () => {
      const organization = await seedOrganization(worker);
      await worker.organizations.deleteOne({ _id: organization._id });
      await expect(
        service.recompute(organization._id),
      ).resolves.toBeUndefined();
      expect(
        await worker.organizations.countDocuments({ _id: organization._id }),
      ).toBe(0);
    });
  });
}

// from organization-usage-audit.e2e-spec.ts
{
  describe('organization usage audit', () => {
    beforeAll(() => worker.reset());
    let audit: OrganizationUsageAuditService;
    let usage: Model<OrganizationUsage>;
    let ledger: Model<OrganizationCreditEntry>;
    const now = new Date('2026-10-15T12:00:00Z');
    const entry = (organization: string, month: string, amount: number) =>
      ledger.create({
        organization,
        month,
        reason: amount < 0 ? 'refund' : 'problem',
        amount,
      });
    /** Runs the audit and returns the parsed drift lines it logged. */
    const driftLines = async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn');
      try {
        const result = await audit.audit(now);
        const lines = warn.mock.calls
          .map(([line]) => String(line))
          .filter((line) => line.includes('organization.usage.drift'))
          .map((line) => JSON.parse(line) as Record<string, unknown>);
        return { result, lines };
      } finally {
        warn.mockRestore();
      }
    };

    beforeAll(() => {
      audit = worker.module.get(OrganizationUsageAuditService);
      usage = worker.module.get(getModelToken(OrganizationUsage.name));
      ledger = worker.module.get(getModelToken(OrganizationCreditEntry.name));
    });

    it('stays quiet when the counter equals the ledger sum, refunds included', async () => {
      const organization = newId();
      await usage.create({ organization, month: '2026-10', creditsUsed: 10 });
      await entry(organization, '2026-10', 10);
      await entry(organization, '2026-10', 10);
      await entry(organization, '2026-10', -10);
      const { result, lines } = await driftLines();
      expect(
        lines.filter((line) => line.organization === organization),
      ).toEqual([]);
      expect(result.checked).toBeGreaterThanOrEqual(1);
    });

    it('logs one line per drifted organization and month and changes nothing', async () => {
      const organization = newId();
      await usage.create({ organization, month: '2026-09', creditsUsed: 50 });
      await entry(organization, '2026-09', 30);
      const missing = newId();
      await entry(missing, '2026-10', 20);
      const { result, lines } = await driftLines();
      expect(lines).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            organization,
            month: '2026-09',
            ledger: 30,
            counter: 50,
          }),
          expect.objectContaining({
            organization: missing,
            month: '2026-10',
            ledger: 20,
            counter: 0,
          }),
        ]),
      );
      expect(result.drifted).toBeGreaterThanOrEqual(2);
      expect((await usage.findOne({ organization }).lean())?.creditsUsed).toBe(
        50,
      );
    });

    it('ignores months older than the previous one', async () => {
      const organization = newId();
      await usage.create({ organization, month: '2026-07', creditsUsed: 5 });
      await entry(organization, '2026-07', 99);
      const { lines } = await driftLines();
      expect(
        lines.filter((line) => line.organization === organization),
      ).toEqual([]);
    });

    it('looks back one calendar month even on the 31st of a long month', async () => {
      const organization = newId();
      await entry(organization, '2026-09', 7);
      const warn = jest.spyOn(Logger.prototype, 'warn');
      await audit.audit(new Date('2026-10-31T12:00:00Z'));
      const seen = warn.mock.calls.some(([line]) =>
        String(line).includes(organization),
      );
      warn.mockRestore();
      expect(seen).toBe(true);
    });
  });
}

// from problem-solvers.e2e-spec.ts
{
  describe('problem-solvers-recompute', () => {
    beforeAll(() => worker.reset());
    let service: ProblemSolversService;
    const countOf = async (userId: string) =>
      (await worker.users.findById(userId, { problemCount: 1 }).lean())!
        .problemCount;

    beforeAll(() => {
      service = worker.module.get(ProblemSolversService);
    });

    it('recomputes every user who submitted to the problem, and only them, in both directions', async () => {
      const solver = await seedUser(worker);
      const bystander = await seedUser(worker, { problemCount: 7 });
      const keep = await seedProblem(worker);
      const gone = await seedProblem(worker);
      await seedGraded(worker, solver._id, keep._id);
      await seedGraded(worker, solver._id, gone._id);
      await softDeleteWorker(worker, gone._id);
      expect(await service.recompute(gone._id)).toBe(1);
      expect(await countOf(solver._id)).toBe(1);
      expect(await countOf(bystander._id)).toBe(7);
      await undeleteWorker(worker, gone._id);
      expect(await service.recompute(gone._id)).toBe(1);
      expect(await countOf(solver._id)).toBe(2);
    });

    it('refreshes the problem user count and acceptance rate, stale after a restore', async () => {
      const solver = await seedUser(worker);
      const problem = await seedProblem(worker, { userCount: 99, acRate: 99 });
      await seedGraded(worker, solver._id, problem._id);
      await seedGraded(worker, solver._id, problem._id, {
        result: 'WA',
        points: 0,
      });
      await service.recompute(problem._id);
      const stats = (await worker.problems.findById(problem._id).lean())!;
      expect(stats.userCount).toBe(1);
      expect(stats.acRate).toBeCloseTo(50);
    });

    it('works through more users than one chunk', async () => {
      const problem = await seedProblem(worker);
      const users = await Promise.all(
        Array.from({ length: 12 }, () => seedUser(worker)),
      );
      for (const user of users) await seedGraded(worker, user._id, problem._id);
      expect(await service.recompute(problem._id)).toBe(12);
      expect(await countOf(users[11]._id)).toBe(1);
    });

    it('consumes the queue: a queued delete recomputes the solver', async () => {
      const queue = worker.module.get<Queue<ProblemSolversJob>>(
        getQueueToken(PROBLEM_SOLVERS_QUEUE),
      );
      const solver = await seedUser(worker);
      const problem = await seedProblem(worker);
      await seedGraded(worker, solver._id, problem._id);
      await service.recompute(problem._id);
      expect(await countOf(solver._id)).toBe(1);
      await softDeleteWorker(worker, problem._id);
      await queue.add('recompute', {
        problemId: problem._id,
        reason: 'deleted',
      });
      await waitUntil(async () => (await countOf(solver._id)) === 0);
      await undeleteWorker(worker, problem._id);
      await queue.add('recompute', {
        problemId: problem._id,
        reason: 'restored',
      });
      await waitUntil(async () => (await countOf(solver._id)) === 1);
    });
  });
}

// from problem-databytes.e2e-spec.ts
{
  describe('problem dataBytes backfill', () => {
    beforeAll(() => worker.reset());
    let service: ProblemDataBytesService;
    let counter = 0;
    const seed = async (
      bytes: number | null,
      extra: Record<string, unknown> = {},
    ) => {
      counter += 1;
      const code = `bf${counter}`;
      if (bytes !== null) {
        mkdirSync(join(worker.problemDataRoot, code), { recursive: true });
        writeFileSync(
          join(worker.problemDataRoot, code, 'tests.zip'),
          Buffer.alloc(bytes),
        );
      }
      // Straight into the collection: some rows need a code the schema would refuse, and `_id` must be a BSON UUID like the real ones.
      await worker.problems.collection.insertOne({
        _id: toUuid(newId()),
        code,
        name: code,
        timeLimit: 1,
        memoryLimit: 1024,
        points: 1,
        dataBytes: 999,
        ...extra,
      } as never);
      return code;
    };
    const stored = async (code: string) =>
      (await worker.problems.findOne({ code }, { dataBytes: 1 }).lean())
        ?.dataBytes;
    const redis = () => worker.module.get<Redis>(REDIS);

    beforeAll(() => {
      service = worker.module.get(ProblemDataBytesService);
    });
    beforeEach(() => redis().del(QUOTA_BACKFILL_DONE_KEY));

    it('sets every problem to the bytes on disk and zero when the directory is gone', async () => {
      const full = await seed(1500);
      const gone = await seed(null);
      await service.backfill();
      expect(await stored(full)).toBe(1500);
      expect(await stored(gone)).toBe(0);
    });

    it('fills a problem that has no dataBytes yet', async () => {
      const legacy = await seed(40, { dataBytes: undefined });
      await service.backfill();
      expect(await stored(legacy)).toBe(40);
    });

    it('is idempotent and reports what it measured', async () => {
      await seed(10);
      await service.backfill();
      const second = await service.backfill();
      expect(second.problems).toBeGreaterThanOrEqual(1);
      expect(second.bytes).toBeGreaterThanOrEqual(10);
    });

    it('measures a problem whose stored code is not a valid directory name as zero instead of failing', async () => {
      await seed(null, { code: 'Bad Code!' });
      await expect(service.backfill()).resolves.toBeDefined();
      expect(await stored('Bad Code!')).toBe(0);
    });

    it('keeps the value a data write recorded while the problem was being measured', async () => {
      const code = await seed(100);
      const files = worker.module.get(ProblemDataFilesService);
      const real = files.bytesOf.bind(files);
      const measuring = jest
        .spyOn(files, 'bytesOf')
        .mockImplementation(async (target) => {
          const size = await real(target);
          if (target === code)
            await worker.problems.updateOne({ code }, { dataBytes: 777 });
          return size;
        });
      await service.backfill();
      measuring.mockRestore();
      expect(await stored(code)).toBe(777);
    });

    it('marks the backfill done only when every problem was measured', async () => {
      await service.backfill();
      expect(await redis().get(QUOTA_BACKFILL_DONE_KEY)).toBe('1');
      await redis().del(QUOTA_BACKFILL_DONE_KEY);
      const failing = jest
        .spyOn(worker.module.get(ProblemDataBytesRepository), 'setSizes')
        .mockRejectedValueOnce(new Error('mongo down'));
      await seed(5);
      await expect(service.backfill()).rejects.toThrow('mongo down');
      failing.mockRestore();
      expect(await redis().get(QUOTA_BACKFILL_DONE_KEY)).toBeNull();
    });

    it('is queued once under a fixed job id, however often it is added', async () => {
      const queue = worker.module.get<Queue>(
        getQueueToken(PROBLEM_DATABYTES_QUEUE),
      );
      const processor = worker.module.get(ProblemDataBytesProcessor);
      await queue.obliterate({ force: true });
      await processor.onApplicationBootstrap();
      await processor.onApplicationBootstrap();
      const jobs = await queue.getJobs([
        'waiting',
        'active',
        'completed',
        'delayed',
        'failed',
      ]);
      expect(jobs.map((job) => job.id)).toEqual([PROBLEM_DATABYTES_JOB_ID]);
    });
  });
}
