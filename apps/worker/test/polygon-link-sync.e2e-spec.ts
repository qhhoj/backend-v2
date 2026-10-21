import { getQueueToken } from '@nestjs/bullmq';
import { getModelToken } from '@nestjs/mongoose';
import type { Job, Queue } from 'bullmq';
import type { Model } from 'mongoose';
import type Redis from 'ioredis';
import { REDIS } from '@libs/common';
import { DiscordWebhooksService } from '@libs/community';
import { newId, OrganizationUsage, PolygonSyncRun } from '@libs/database';
import {
  autoSyncJobId,
  POLYGON_ERROR_PREFIX,
  POLYGON_FETCH,
  POLYGON_QUEUE,
  QUOTA_BACKFILL_DONE_KEY,
  QuotaLedger,
} from '@libs/problems';
import type { ImportProgress, PolygonImportJob } from '@libs/problems';
import { FakePolygon } from '@libs/problems/testing';
import { ImportQuota } from '../src/jobs/polygon-import/import-quota.service';
import { PandocService } from '../src/jobs/polygon-import/pandoc.service';
import { PolygonImportProcessor } from '../src/jobs/polygon-import/polygon-import.processor';
import { ProblemPurgeService } from '../src/jobs/problem-purge/problem-purge.service';
import { PolygonAutoSyncService } from '../src/jobs/polygon-autosync/polygon-autosync.service';
import { seedContest } from './effects-fixtures';
import { buildPolygonPackage, properties } from './polygon-fixtures';
import type { PolygonFixture } from './polygon-fixtures';
import { softDeleteWorker } from './deleted-problem-fixtures';
import { setupWorkerTest } from './setup';
import type { WorkerTest } from './setup';

const fakePandoc = {
  assertAvailable: () => Promise.resolve(),
  texToMarkdown: (tex: string) => Promise.resolve(tex),
};
const POLYGON_ID = 4242;
const fixtureNamed = (name: string, timeLimitMs = 1000): PolygonFixture => ({
  tests: [{ input: '1 2', answer: '3', points: 100 }],
  timeLimitMs,
  statements: [
    {
      language: 'english',
      name,
      properties: properties({ legend: `${name}.` }),
    },
  ],
  solution: null,
});
const BUILT_AT = '2026-10-01T08:00:00.000Z';
/** A READY full package's Linux row: the variant a sync downloads. */
const ready = (id: number, revision: number) => ({
  id,
  revision,
  state: 'READY',
  type: 'linux',
  creationTimeSeconds: Date.parse(BUILT_AT) / 1000,
});

describe('Polygon link, sync and auto-sync', () => {
  let worker: WorkerTest;
  let processor: PolygonImportProcessor;
  let autoSync: PolygonAutoSyncService;
  let imports: Queue<PolygonImportJob>;
  let runs: Model<PolygonSyncRun>;
  const polygon = new FakePolygon();
  let requesterId: string, groupId: string, otherGroupId: string;
  let typeId: string, otherLanguageId: string;

  /** A job as BullMQ hands it to the processor, recording the progress it reports. */
  const runJob = async (data: PolygonImportJob) => {
    const progress: ImportProgress[] = [];
    const job = {
      id: newId(),
      data,
      updateProgress: (value: ImportProgress) => {
        progress.push(value);
        return Promise.resolve();
      },
      updateData: (value: PolygonImportJob) => {
        job.data = value;
        return Promise.resolve();
      },
    } as unknown as Job<PolygonImportJob>;
    const outcome = await processor.process(job).then(
      (result) => ({ result, error: null }),
      (error: Error) => ({ result: null, error: error.message }),
    );
    return {
      ...outcome,
      jobId: job.id!,
      failedStep: job.data.failedStep,
      steps: progress.map(({ step }) => step),
    };
  };
  const linkJob = (
    code: string,
    packageId: number,
    polygonId = POLYGON_ID,
  ): PolygonImportJob => ({
    requesterId,
    code,
    mode: 'create',
    groupId,
    typeIds: [typeId],
    points: 900,
    authors: [requesterId],
    isFullMarkup: false,
    mainStatementLanguage: 'english',
    statementLanguages: {},
    tutorialLanguage: null,
    ignoreZeroPointBatches: false,
    ignoreZeroPointCases: false,
    appendMainSolution: false,
    maxCases: 300,
    polygon: {
      problemId: polygonId,
      name: 'sum-polygon',
      owner: 'setter',
      revision: 3,
      packageId,
      packageCreatedAt: BUILT_AT,
      purpose: 'link',
      autoSync: true,
    },
  });
  const syncJob = (
    code: string,
    { packageId, revision }: { packageId: number; revision: number },
    dataVersion: number,
  ): PolygonImportJob => ({
    ...linkJob(code, packageId),
    mode: 'update',
    groupId: undefined,
    typeIds: undefined,
    points: undefined,
    authors: undefined,
    expectedDataVersion: dataVersion,
    polygon: {
      ...linkJob(code, packageId).polygon!,
      revision,
      purpose: 'sync',
    },
  });
  const linked = async (
    code: string,
    packageId = 10,
    polygonId = POLYGON_ID,
  ) => {
    polygon.reply('problem.package', {
      zip: buildPolygonPackage(fixtureNamed('Sum')),
    });
    const { error } = await runJob(linkJob(code, packageId, polygonId));
    expect(error).toBeNull();
    return (await worker.problems.findOne({ code }))!.toObject({
      getters: true,
    });
  };

  beforeAll(async () => {
    worker = await setupWorkerTest({
      overrides: [
        { provide: PandocService, useValue: fakePandoc },
        { provide: POLYGON_FETCH, useValue: polygon.fetch },
      ],
    });
    processor = worker.module.get(PolygonImportProcessor);
    autoSync = worker.module.get(PolygonAutoSyncService);
    imports = worker.module.get(getQueueToken(POLYGON_QUEUE));
    runs = worker.module.get(getModelToken(PolygonSyncRun.name));
    await worker.setSetting('polygon.apiKey', 'KEY');
    await worker.setSetting('polygon.apiSecret', 'SECRET');
    groupId = (await worker.problemGroups.create({ name: 'A', fullName: 'A' }))
      ._id;
    otherGroupId = (
      await worker.problemGroups.create({ name: 'B', fullName: 'B' })
    )._id;
    typeId = (await worker.problemTypes.create({ name: 't', fullName: 'T' }))
      ._id;
    const language = (key: string) =>
      worker.languages.create({
        key,
        name: key,
        commonName: key,
        ace: 'c_cpp',
        pygments: 'cpp',
        extension: 'cpp',
        includeInProblem: true,
      });
    await language('CPP17');
    otherLanguageId = (await language('CPP20'))._id;
    requesterId = (
      await worker.users.create({
        username: 'setter',
        password: '!',
        isActive: true,
        permissions: [
          'judge.sync_polygon_problem',
          'judge.edit_own_problem',
          'judge.add_problem',
        ],
      })
    )._id;
  });
  beforeEach(async () => {
    polygon.reset();
    // One QHHOJ problem per Polygon problem: every test links POLYGON_ID afresh.
    await worker.problems.updateMany({}, { $set: { polygonLink: null } });
  });
  afterAll(() => worker.teardown());

  it('downloads the package from Polygon, imports it and links the problem, reporting each step', async () => {
    polygon.reply('problem.package', {
      zip: buildPolygonPackage(fixtureNamed('Sum')),
    });
    const { result, error, steps, jobId } = await runJob(linkJob('linked', 10));
    expect(error).toBeNull();
    expect(result).toMatchObject({ code: 'linked' });
    expect(polygon.callsOf('problem.package')[0].params).toMatchObject({
      problemId: String(POLYGON_ID),
      packageId: '10',
      type: 'linux',
    });
    expect(steps[0]).toBe('downloading');
    expect(steps.slice(-2)).toEqual(['statements', 'tests']);
    expect(steps).not.toContain('generating');
    const problem = (await worker.problems.findOne({
      code: 'linked',
    }))!.toObject({
      getters: true,
    });
    expect(problem).toMatchObject({ name: 'Sum', points: 900 });
    expect(problem.polygonLink).toMatchObject({
      problemId: POLYGON_ID,
      revision: 3,
      packageId: 10,
      linkedBy: requesterId,
      autoSync: true,
      lastSyncResult: 'ok',
      lastSyncPackageId: 10,
      title: 'Sum',
      packageCreatedAt: new Date(BUILT_AT),
      options: { mainStatementLanguage: 'english', maxCases: 300 },
    });
    expect(await runs.find({ jobId }).lean()).toEqual([
      expect.objectContaining({
        code: 'linked',
        polygonProblemId: POLYGON_ID,
        revision: 3,
        packageId: 10,
        packageCreatedAt: new Date(BUILT_AT),
        packageType: 'full',
        purpose: 'link',
        trigger: 'manual',
        result: 'ok',
        failedStep: null,
        error: null,
      }),
    ]);
    expect(String((await runs.findOne({ jobId }).lean())!.problem)).toBe(
      String(problem._id),
    );
  });

  it('imports the same Polygon problem again once the problem that held it is deleted and purged', async () => {
    const first = await linked('before_purge');
    await softDeleteWorker(worker, first._id, {
      deletedAt: new Date(Date.now() - 40 * 86_400_000),
    });
    await worker.module.get(ProblemPurgeService).purge(first._id);
    const tomb = await worker.problems.findOne({ code: 'before_purge' });
    expect(tomb).toMatchObject({ polygonLink: null });
    expect(tomb!.purgedAt).toBeInstanceOf(Date);
    polygon.reply('problem.package', {
      zip: buildPolygonPackage(fixtureNamed('Sum')),
    });
    const again = await runJob(linkJob('after_purge', 11));
    expect(again.error).toBeNull();
    expect(
      (await worker.problems.findOne({ code: 'after_purge' }))!.polygonLink,
    ).toMatchObject({ problemId: POLYGON_ID, packageId: 11 });
  });

  it('refuses a second problem linked to the same Polygon problem and creates nothing', async () => {
    await linked('first_link');
    polygon.reply('problem.package', {
      zip: buildPolygonPackage(fixtureNamed('Sum')),
    });
    const { error } = await runJob(linkJob('second_link', 10));
    expect(error).toBe(
      `${POLYGON_ERROR_PREFIX}Polygon problem ${POLYGON_ID} is already linked to another QHHOJ problem`,
    );
    expect(await worker.problems.countDocuments({ code: 'second_link' })).toBe(
      0,
    );
  });

  it('stores where a failed job stopped, on the job and in the history; a zip import has no history', async () => {
    const { error, failedStep, jobId } = await runJob(
      syncJob('never_linked', { packageId: 11, revision: 4 }, 0),
    );
    expect(error).toBe(
      `${POLYGON_ERROR_PREFIX}problem with code never_linked not found`,
    );
    expect(failedStep).toBe('checking');
    expect(await runs.findOne({ jobId }).lean()).toMatchObject({
      problem: null,
      result: 'failed',
      failedStep: 'checking',
      error: 'problem with code never_linked not found',
    });
    const zipRun = await runJob({
      ...linkJob('zip_missing', 1),
      mode: 'update',
      polygon: undefined,
    });
    expect(zipRun.failedStep).toBe('checking');
    expect(await runs.countDocuments({ jobId: zipRun.jobId })).toBe(0);
  });

  it('syncs statement, tests and limits from a newer package and keeps the QHHOJ-owned fields', async () => {
    const before = await linked('kept');
    await worker.problems.updateOne(
      { code: 'kept' },
      {
        $set: {
          points: 1500,
          groupId: otherGroupId,
          authors: [],
          curators: [requesterId],
          allowedLanguages: [otherLanguageId],
        },
      },
    );
    polygon.reply('problem.package', {
      zip: buildPolygonPackage(fixtureNamed('Sum v2', 2000)),
    });
    const { error } = await runJob(
      syncJob('kept', { packageId: 11, revision: 4 }, before.dataVersion),
    );
    expect(error).toBeNull();
    const after = (await worker.problems.findOne({ code: 'kept' }))!.toObject({
      getters: true,
    });
    expect(after).toMatchObject({
      name: 'Sum v2',
      timeLimit: 2,
      points: 1500,
      groupId: otherGroupId,
      authors: [],
      curators: [requesterId],
      allowedLanguages: [otherLanguageId],
      dataVersion: before.dataVersion + 1,
    });
    expect(after.polygonLink).toMatchObject({
      revision: 4,
      packageId: 11,
      lastSyncResult: 'ok',
      lastSyncError: null,
      autoSync: true,
      linkedAt: before.polygonLink!.linkedAt,
    });
  });

  it('keeps the catalog of an update that names empty authors, curators and types', async () => {
    const before = await linked('empty_update');
    await worker.problems.updateOne(
      { code: 'empty_update' },
      { $set: { authors: [requesterId], curators: [requesterId] } },
    );
    polygon.reply('problem.package', {
      zip: buildPolygonPackage(fixtureNamed('Sum v2', 2000)),
    });
    const { error } = await runJob({
      ...syncJob(
        'empty_update',
        { packageId: 11, revision: 4 },
        before.dataVersion,
      ),
      authors: [],
      curators: [],
      typeIds: [],
    });
    expect(error).toBeNull();
    const after = (await worker.problems.findOne({ code: 'empty_update' }))!;
    expect(after.authors).toEqual([requesterId]);
    expect(after.curators).toEqual([requesterId]);
    expect(after.typeIds).toEqual([typeId]);
  });

  it('gives a create that names no types the default type', async () => {
    polygon.reply('problem.package', {
      zip: buildPolygonPackage(fixtureNamed('Sum')),
    });
    const { error } = await runJob({
      ...linkJob('empty_create', 10),
      typeIds: [],
    });
    expect(error).toBeNull();
    const created = (await worker.problems.findOne({ code: 'empty_create' }))!;
    expect(created.typeIds).toEqual([typeId]);
  });

  it('records a failed sync on the link and leaves the problem as it was', async () => {
    const before = await linked('broken');
    polygon.reply('problem.package', {
      failed: 'packageId: Package is not full',
    });
    const { error, failedStep, jobId } = await runJob(
      syncJob('broken', { packageId: 12, revision: 5 }, before.dataVersion),
    );
    expect(error).toBe(
      `${POLYGON_ERROR_PREFIX}Polygon: problem.package for package 12 of problem 4242 (type linux): packageId: Package is not full`,
    );
    expect(failedStep).toBe('downloading');
    const run = await runs.findOne({ jobId }).lean();
    expect(run).toMatchObject({
      purpose: 'sync',
      packageId: 12,
      result: 'failed',
      failedStep: 'downloading',
      error:
        'Polygon: problem.package for package 12 of problem 4242 (type linux): packageId: Package is not full',
    });
    expect(String(run!.problem)).toBe(String(before._id));
    const after = (await worker.problems.findOne({ code: 'broken' }))!.toObject(
      {
        getters: true,
      },
    );
    expect(after.name).toBe('Sum');
    expect(after.dataVersion).toBe(before.dataVersion);
    expect(after.polygonLink).toMatchObject({
      packageId: 10,
      lastSyncResult: 'failed',
      lastSyncError:
        'Polygon: problem.package for package 12 of problem 4242 (type linux): packageId: Package is not full',
      lastSyncPackageId: 12,
    });
  });

  it('refuses a sync of a problem unlinked after it was queued, before downloading', async () => {
    const before = await linked('unlinked');
    await worker.problems.updateOne(
      { code: 'unlinked' },
      { $set: { polygonLink: null } },
    );
    polygon.reset();
    const { error } = await runJob(
      syncJob('unlinked', { packageId: 11, revision: 4 }, before.dataVersion),
    );
    expect(error).toBe(
      `${POLYGON_ERROR_PREFIX}the problem is no longer linked to Polygon problem ${POLYGON_ID}`,
    );
    expect(polygon.calls).toEqual([]);
  });

  it.each([
    ['is deactivated', { isActive: false }, null],
    [
      'loses the sync permission',
      { permissions: ['judge.edit_own_problem'] },
      null,
    ],
    [
      'is no longer an editor of the problem',
      {},
      { authors: [], curators: [] },
    ],
  ])(
    'refuses a sync, before downloading, once the requesting user %s',
    async (_case, userChange, problemChange) => {
      const code = `lost_${newId().slice(-8)}`;
      const before = await linked(code);
      const restore = await worker.users.findById(requesterId).lean();
      await worker.users.updateOne({ _id: requesterId }, userChange);
      if (problemChange)
        await worker.problems.updateOne({ code }, problemChange);
      polygon.reset();
      try {
        const { error } = await runJob(
          syncJob(code, { packageId: 11, revision: 4 }, before.dataVersion),
        );
        expect(error).toBe(
          `${POLYGON_ERROR_PREFIX}the requesting user may no longer sync this problem`,
        );
        expect(polygon.calls).toEqual([]);
      } finally {
        await worker.users.updateOne(
          { _id: requesterId },
          { isActive: restore!.isActive, permissions: restore!.permissions },
        );
      }
    },
  );

  describe('auto-sync', () => {
    beforeAll(() => imports.pause());
    afterAll(() => imports.resume());
    beforeEach(() => imports.drain(true));

    it('queues a sync of a newer READY package, with the linking user as requester', async () => {
      const problem = await linked('auto_new');
      polygon.reply('problem.packages', {
        result: [ready(10, 3), ready(20, 6)],
      });
      const summary = await autoSync.run();
      expect(summary.queued).toBeGreaterThanOrEqual(1);
      const job = await imports.getJob(autoSyncJobId(problem._id, 20));
      expect(job?.data).toMatchObject({
        code: 'auto_new',
        mode: 'update',
        requesterId,
        expectedDataVersion: problem.dataVersion,
        polygon: {
          packageId: 20,
          revision: 6,
          purpose: 'sync',
          trigger: 'auto',
          packageCreatedAt: BUILT_AT,
        },
      });
      expect(job?.data.points).toBeUndefined();
    });

    it('defers a problem used by a running contest, and skips the synced package, a failed one and switched-off links', async () => {
      const inContest = await linked('auto_contest');
      await seedContest(worker, {
        problems: [{ problem: inContest._id, points: 100, order: 0 }],
      } as never);
      const failed = await linked('auto_failed', 10, POLYGON_ID + 1);
      await worker.problems.updateOne(
        { code: 'auto_failed' },
        {
          $set: {
            'polygonLink.lastSyncResult': 'failed',
            'polygonLink.lastSyncPackageId': 30,
          },
        },
      );
      const off = await linked('auto_off', 10, POLYGON_ID + 2);
      await worker.problems.updateOne(
        { code: 'auto_off' },
        { $set: { 'polygonLink.autoSync': false } },
      );
      polygon.reply('problem.packages', { result: [ready(30, 7)] });
      const summary = await autoSync.run();
      expect(summary.deferred).toBe(1);
      for (const problem of [inContest, failed, off])
        expect(
          await imports.getJob(autoSyncJobId(problem._id, 30)),
        ).toBeUndefined();
    });

    it('does nothing while Polygon is not connected', async () => {
      await worker.setSetting('polygon.apiSecret', '');
      try {
        expect(await autoSync.run()).toEqual({
          checked: 0,
          queued: 0,
          deferred: 0,
        });
        expect(polygon.calls).toEqual([]);
      } finally {
        await worker.setSetting('polygon.apiSecret', 'SECRET');
      }
    });
  });

  describe('a create for an organization', () => {
    let usage: Model<OrganizationUsage>;
    let ledger: QuotaLedger;
    let organizationId: string;
    const announce = jest.fn(() => Promise.resolve());
    const creditsUsed = async () =>
      (await usage.findOne({ organization: organizationId }).lean())
        ?.creditsUsed;
    /** The api spent 10 credits when it queued the job. */
    const chargedJob = async (code: string): Promise<PolygonImportJob> => {
      const month = ledger.monthKeyOf(new Date());
      await usage.updateOne(
        { organization: organizationId, month },
        { $inc: { creditsUsed: 10 } },
        { upsert: true },
      );
      return {
        ...linkJob(code, 10),
        organizationId,
        meteredOrganizationId: organizationId,
        charge: {
          organizationId,
          month,
          kind: 'problem',
          amount: 10,
          userId: requesterId,
          ref: code,
        },
      };
    };

    beforeAll(async () => {
      usage = worker.module.get(getModelToken(OrganizationUsage.name));
      ledger = worker.module.get(QuotaLedger);
      jest
        .spyOn(worker.module.get(DiscordWebhooksService), 'announceNewProblem')
        .mockImplementation(announce);
      organizationId = (
        await worker.organizations.create({
          name: 'THPT A',
          slug: 'thpt-a',
          shortName: 'A',
          quotaStorageBytes: 100,
        })
      )._id;
      await worker.setSetting('quota.enforce', 'enforce');
      await worker.module.get<Redis>(REDIS).set(QUOTA_BACKFILL_DONE_KEY, '1');
    });
    beforeEach(async () => {
      announce.mockClear();
      await usage.deleteMany({});
    });
    afterAll(() => jest.restoreAllMocks());

    it('refuses a downloaded package over the storage limit, names the numbers and gives the credits back', async () => {
      polygon.reply('problem.package', {
        zip: buildPolygonPackage(fixtureNamed('Big')),
      });
      const { error, failedStep } = await runJob(await chargedJob('org_big'));
      expect(error).toMatch(
        /^polygon-import: the organization's storage is full: 0 of 100 bytes used, the package needs \d+ more$/,
      );
      expect(failedStep).toBe('downloading');
      expect(await worker.problems.findOne({ code: 'org_big' })).toBeNull();
      expect(await creditsUsed()).toBe(0);
      expect(announce).not.toHaveBeenCalled();
    });

    it('creates the problem, keeps the credits spent and announces it as a new organization problem', async () => {
      await worker.organizations.updateOne(
        { _id: organizationId },
        { quotaStorageBytes: null },
      );
      polygon.reply('problem.package', {
        zip: buildPolygonPackage(fixtureNamed('Sum')),
      });
      const { error } = await runJob(await chargedJob('org_sum'));
      expect(error).toBeNull();
      expect(await creditsUsed()).toBe(10);
      expect(announce).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'org_sum', name: 'Sum' }),
        'create',
        'setter',
      );
    });

    it('meters a sync of an organization-private problem by the package size less the test data it replaces', async () => {
      await worker.organizations.updateOne(
        { _id: organizationId },
        { quotaStorageBytes: 100 },
      );
      const before = await linked('org_synced');
      await worker.problems.updateOne(
        { code: 'org_synced' },
        {
          isOrganizationPrivate: true,
          organizations: [organizationId],
          dataBytes: 0,
        },
      );
      polygon.reply('problem.package', {
        zip: buildPolygonPackage(fixtureNamed('Sum2')),
      });
      const sync = () =>
        runJob(
          syncJob(
            'org_synced',
            { packageId: 11, revision: 4 },
            before.dataVersion,
          ),
        );
      const refused = await sync();
      expect(refused.error).toMatch(
        /^polygon-import: the organization's storage is full: \d+ of 100 bytes used, the package needs \d+ more$/,
      );
      expect(await creditsUsed()).toBeUndefined();
      await worker.problems.updateOne(
        { code: 'org_synced' },
        { dataBytes: 10_000_000 },
      );
      expect((await sync()).error).toBeNull();
    });

    it('gives the credits of one job back once, and none after the write committed', async () => {
      const quota = worker.module.get(ImportQuota);
      const job = await chargedJob('org_once');
      await quota.refundFailed('job-a', job, 'tests');
      await quota.refundFailed('job-a', job, 'tests');
      expect(await creditsUsed()).toBe(0);
      await chargedJob('org_once');
      await quota.refundFailed('job-b', job, 'finishing');
      expect(await creditsUsed()).toBe(10);
    });
  });
});
