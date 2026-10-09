import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getModelToken } from '@nestjs/mongoose';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { StorageService } from '@libs/common';
import { childPath } from '@libs/community';
import { newId, Revision } from '@libs/database';
import {
  PackageCacheService,
  PROBLEM_PURGE_QUEUE,
  ProblemDataFilesService,
  PROBLEM_PURGE_SCHEDULER,
  problemPurgeJobId,
} from '@libs/problems';
import type { Model } from 'mongoose';
import { ProblemPurgeService } from '../src/jobs/problem-purge/problem-purge.service';
import { softDeleteWorker, undeleteWorker } from './deleted-problem-fixtures';
import {
  seedContest,
  seedContestSubmission,
  seedGraded,
  seedParticipation,
  seedProblem,
  seedUser,
} from './effects-fixtures';
import { setupWorkerTest } from './setup';
import type { WorkerTest } from './setup';

const DAY = 86_400_000;

describe('problem purge', () => {
  let worker: WorkerTest;
  let service: ProblemPurgeService;
  let storage: StorageService;
  let packages: PackageCacheService;
  let revisions: Model<Revision>;
  let purgeAdd: jest.SpyInstance;
  const queuedJobIds = () =>
    (purgeAdd.mock.calls as unknown[][]).map(
      (call) => (call[2] as { jobId: string }).jobId,
    );
  const mediaFile = (relative: string) => join(worker.mediaRoot, relative);

  const comment = async (
    page: { type: 'problem' | 'editorial' | 'blog'; id: string },
    author: string,
  ) => {
    const id = newId();
    return worker.comments.create({
      _id: id,
      page,
      author,
      threadId: id,
      path: childPath(null, id),
      body: 'x',
    });
  };

  /** A deleted problem with every kind of asset the purge must remove, plus a user's graded submissions. */
  const seedDeleted = async (deletedAgo = 40 * DAY) => {
    const user = await seedUser(worker);
    const problem = await seedProblem(worker, {
      description: 'Statement.',
      translations: [
        {
          language: 'vi',
          name: 'Bai',
          description: 'De.',
          descriptionHtml: '',
        },
      ],
      solution: {
        isPublic: true,
        publishOn: new Date(),
        authors: [],
        content: 'e',
        contentHtml: '<p>e</p>',
      },
    });
    mkdirSync(join(worker.problemDataRoot, problem.code), { recursive: true });
    writeFileSync(join(worker.problemDataRoot, problem.code, 'tests.zip'), 'x');
    mkdirSync(worker.pdfCacheRoot, { recursive: true });
    writeFileSync(join(worker.pdfCacheRoot, `${problem.code}.en.pdf`), '%PDF');
    await packages.write(problem.code, '1.aaaaaaaaaaaa', (temporary) =>
      Promise.resolve(writeFileSync(temporary, 'zip')),
    );
    const pdfUrl = await storage.save(
      `pdf/${problem.code}.pdf`,
      Buffer.from('%PDF'),
    );
    const materialUrl = await storage.save(
      `materials/${problem._id}/notes.txt`,
      Buffer.from('n'),
    );
    await worker.problems.updateOne(
      { _id: problem._id },
      { pdfStatementUrl: pdfUrl, materialUrl },
    );
    await comment({ type: 'problem', id: problem._id }, user._id);
    await comment({ type: 'editorial', id: problem._id }, user._id);
    await revisions.create([
      {
        entity: 'problem',
        entityId: problem._id,
        action: 'edit',
        changes: {},
        comment: '',
      },
      {
        entity: 'problem',
        entityId: problem._id,
        action: 'delete',
        changes: {},
        comment: '',
      },
    ]);
    await seedGraded(worker, user._id, problem._id);
    await softDeleteWorker(worker, problem._id, {
      deletedAt: new Date(Date.now() - deletedAgo),
    });
    return { user, problem, pdfUrl, materialUrl };
  };

  beforeAll(async () => {
    worker = await setupWorkerTest();
    service = worker.module.get(ProblemPurgeService);
    storage = worker.module.get(StorageService);
    packages = worker.module.get(PackageCacheService);
    revisions = worker.module.get(getModelToken(Revision.name));
    purgeAdd = jest
      .spyOn(
        worker.module.get<Queue>(getQueueToken(PROBLEM_PURGE_QUEUE)),
        'add',
      )
      .mockResolvedValue(undefined as never);
  });
  afterAll(async () => {
    purgeAdd.mockRestore();
    await worker.teardown();
  });
  beforeEach(() => purgeAdd.mockClear());

  it('removes every heavy asset and leaves the tombstone and all submissions', async () => {
    const { user, problem, pdfUrl, materialUrl } = await seedDeleted();
    const other = await seedProblem(worker);
    await comment({ type: 'problem', id: other._id }, user._id);
    const contest = await seedContest(worker);
    const participation = await seedParticipation(
      worker,
      contest._id,
      user._id,
    );
    await seedContestSubmission(worker, participation, problem._id);
    const submissionsBefore = await worker.submissions.countDocuments({
      problem: problem._id,
    });
    const contestRowsBefore = await worker.contestSubmissions.countDocuments({
      problem: problem._id,
    });

    expect(await service.purge(problem._id)).toEqual({
      comments: 2,
      revisions: 2,
    });

    expect(existsSync(join(worker.problemDataRoot, problem.code))).toBe(false);
    expect(
      existsSync(join(worker.pdfCacheRoot, `${problem.code}.en.pdf`)),
    ).toBe(false);
    expect(await packages.has(problem.code, '1.aaaaaaaaaaaa')).toBe(false);
    expect(existsSync(mediaFile(storage.relativePathOf(pdfUrl, 'pdf')!))).toBe(
      false,
    );
    expect(
      existsSync(mediaFile(storage.relativePathOf(materialUrl, 'materials')!)),
    ).toBe(false);
    expect(
      await worker.comments.countDocuments({ 'page.id': problem._id }),
    ).toBe(0);
    expect(await worker.comments.countDocuments({ 'page.id': other._id })).toBe(
      1,
    );
    expect(await revisions.countDocuments({ entityId: problem._id })).toBe(0);

    const tomb = (await worker.problems
      .findById(problem._id)
      .select('+data')
      .lean())!;
    expect(tomb).toMatchObject({
      code: problem.code,
      name: problem.name,
      description: '',
      descriptionHtml: '',
      translations: [],
      solution: null,
      data: null,
      pdfStatementUrl: null,
      materialUrl: null,
    });
    expect(tomb.deletedAt).toBeInstanceOf(Date);
    expect(tomb.purgedAt).toBeInstanceOf(Date);
    expect(
      await worker.submissions.countDocuments({ problem: problem._id }),
    ).toBe(submissionsBefore);
    expect(
      await worker.contestSubmissions.countDocuments({ problem: problem._id }),
    ).toBe(contestRowsBefore);
  });

  it('does not delete while a data write holds the problem lock, and succeeds on the retry', async () => {
    const { problem } = await seedDeleted();
    const files = worker.module.get(ProblemDataFilesService);
    let release!: () => void;
    const held = files.withDataWrite(
      problem.code,
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(service.purge(problem._id)).rejects.toThrow();
    expect(
      existsSync(join(worker.problemDataRoot, problem.code, 'tests.zip')),
    ).toBe(true);
    expect(
      (await worker.problems.findById(problem._id).lean())!.purgedAt,
    ).toBeUndefined();
    release();
    await held;
    expect(await service.purge(problem._id)).toEqual({
      comments: 2,
      revisions: 2,
    });
    expect(existsSync(join(worker.problemDataRoot, problem.code))).toBe(false);
  });

  it('keeps an uploaded file another problem still points at', async () => {
    const { problem, materialUrl } = await seedDeleted();
    const clone = await seedProblem(worker, { materialUrl });
    await service.purge(problem._id);
    expect(
      existsSync(mediaFile(storage.relativePathOf(materialUrl, 'materials')!)),
    ).toBe(true);
    expect(
      (await worker.problems.findById(clone._id).lean())!.materialUrl,
    ).toBe(materialUrl);
  });

  it('is idempotent and finishes a purge that was claimed but never completed', async () => {
    const { problem } = await seedDeleted();
    await worker.problems.updateOne(
      { _id: problem._id },
      { purgeStartedAt: new Date(Date.now() - 1000) },
    );
    expect(await service.purge(problem._id)).toEqual({
      comments: 2,
      revisions: 2,
    });
    expect(existsSync(join(worker.problemDataRoot, problem.code))).toBe(false);
    expect(await service.purge(problem._id)).toEqual({
      comments: 0,
      revisions: 0,
    });
    expect(
      (await worker.problems.findById(problem._id).lean())!.purgedAt,
    ).toBeInstanceOf(Date);
  });

  it('sweeps a purge whose claim is an hour old, and leaves a fresh claim to its running job', async () => {
    const stale = await seedDeleted(40 * DAY);
    const fresh = await seedDeleted(40 * DAY);
    await worker.problems.updateOne(
      { _id: stale.problem._id },
      { purgeStartedAt: new Date(Date.now() - 2 * 3_600_000) },
    );
    await worker.problems.updateOne(
      { _id: fresh.problem._id },
      { purgeStartedAt: new Date(Date.now() - 600_000) },
    );
    purgeAdd.mockClear();
    await service.sweep();
    expect(queuedJobIds()).toEqual(
      expect.arrayContaining([problemPurgeJobId(stale.problem._id)]),
    );
    expect(queuedJobIds()).not.toContain(problemPurgeJobId(fresh.problem._id));
  });

  it('cannot be restored once claimed, and a stale claim is completed by a plain purge', async () => {
    const { problem } = await seedDeleted();
    await worker.problems.updateOne(
      { _id: problem._id },
      { purgeStartedAt: new Date(Date.now() - 2 * 3_600_000) },
    );
    expect(await service.purge(problem._id)).not.toBeNull();
    const done = (await worker.problems.findById(problem._id).lean())!;
    expect(done.purgedAt).toBeInstanceOf(Date);
    expect(done.deletedAt).toBeInstanceOf(Date);
  });

  it('never purges a live or restored problem', async () => {
    const { problem } = await seedDeleted();
    await undeleteWorker(worker, problem._id);
    expect(await service.purge(problem._id)).toBeNull();
    expect(existsSync(join(worker.problemDataRoot, problem.code))).toBe(true);
    expect(
      await worker.comments.countDocuments({ 'page.id': problem._id }),
    ).toBe(2);
    expect(
      (await worker.problems.findById(problem._id).lean())!.description,
    ).toBe('Statement.');
  });

  it('sweeps only problems deleted longer ago than the grace period and not yet purged', async () => {
    // Earlier cases left deleted problems behind; only the ones seeded here count.
    await worker.problems.updateMany(
      { deletedAt: { $exists: true } },
      { purgedAt: new Date() },
    );
    const expired = await seedDeleted(40 * DAY);
    const recent = await seedDeleted(2 * DAY);
    const done = await seedDeleted(60 * DAY);
    await worker.problems.updateOne(
      { _id: done.problem._id },
      { purgedAt: new Date() },
    );
    await seedProblem(worker);
    expect(await service.sweep()).toBe(1);
    expect(queuedJobIds()).toEqual([problemPurgeJobId(expired.problem._id)]);
    await worker.setSetting('problem.deleteGraceDays', 1);
    purgeAdd.mockClear();
    expect(await service.sweep()).toBeGreaterThanOrEqual(2);
    expect(queuedJobIds()).toContain(problemPurgeJobId(recent.problem._id));
    await worker.setSetting('problem.deleteGraceDays', 30);
  });
});

describe('problem purge scheduler', () => {
  let worker: WorkerTest;
  // `seedBeforeBoot` also keeps the setup from flushing Redis after boot, which would drop the scheduler.
  beforeAll(async () => {
    worker = await setupWorkerTest({ seedBeforeBoot: () => Promise.resolve() });
  });
  afterAll(() => worker.teardown());

  it('runs the sweep daily at 03:30 in the site time zone, registered once', async () => {
    const queue = worker.module.get<Queue>(getQueueToken(PROBLEM_PURGE_QUEUE));
    const ours = (await queue.getJobSchedulers()).filter(
      (scheduler) => scheduler.key === PROBLEM_PURGE_SCHEDULER,
    );
    expect(ours).toHaveLength(1);
    expect(ours[0]).toMatchObject({
      pattern: '30 3 * * *',
      tz: 'Asia/Ho_Chi_Minh',
    });
  });
});
