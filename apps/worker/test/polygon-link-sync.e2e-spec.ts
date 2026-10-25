import { getQueueToken } from '@nestjs/bullmq';
import { getModelToken } from '@nestjs/mongoose';
import { DelayedError, UnrecoverableError } from 'bullmq';
import type { Job, Queue } from 'bullmq';
import { readFile, writeFile } from 'node:fs/promises';
import { parse } from 'yaml';
import type { Model } from 'mongoose';
import type Redis from 'ioredis';
import { REDIS } from '@libs/common';
import { waitUntil } from '@libs/common/testing';
import { DiscordWebhooksService } from '@libs/community';
import {
  newId,
  OrganizationUsage,
  PolygonSyncRun,
  Revision,
  SYNCED_SETTINGS,
} from '@libs/database';
import {
  syncJobId,
  POLYGON_ERROR_PREFIX,
  POLYGON_FETCH,
  POLYGON_QUEUE,
  QUOTA_BACKFILL_DONE_KEY,
  ProblemDataFilesService,
  QuotaLedger,
} from '@libs/problems';
import type { ImportProgress, PolygonImportJob } from '@libs/problems';
import { FakePolygon } from '@libs/problems/testing';
import { ImportQuota } from '../src/jobs/polygon-import/import-quota.service';
import { PandocService } from '../src/jobs/polygon-import/pandoc.service';
import { PolygonImportError } from '../src/jobs/polygon-import/polygon-import.error';
import { PolygonImportProcessor } from '../src/jobs/polygon-import/polygon-import.processor';
import { PolygonImportService } from '../src/jobs/polygon-import/polygon-import.service';
import {
  fingerprintsOf,
  sourceHashOf,
} from '../src/jobs/polygon-import/local-edits';
import { ProblemPurgeService } from '../src/jobs/problem-purge/problem-purge.service';
import { PolygonAutoSyncService } from '../src/jobs/polygon-autosync/polygon-autosync.service';
import { seedContest, seedProblem } from './effects-fixtures';
import { buildPolygonPackage, properties } from './polygon-fixtures';
import type { PolygonFixture } from './polygon-fixtures';
import { softDeleteWorker } from './deleted-problem-fixtures';
import { setupWorkerTest } from './setup';
import type { WorkerTest } from './setup';

/** Runs once while the next job reads its statements: after the download, before the write. */
let whileReading: (() => Promise<unknown>) | null = null;
const fakePandoc = {
  assertAvailable: () => Promise.resolve(),
  texToMarkdown: async (tex: string) => {
    const hook = whileReading;
    whileReading = null;
    await hook?.();
    return tex;
  },
};
const POLYGON_ID = 4242;
const fixtureNamed = (
  name: string,
  timeLimitMs = 1000,
  extra: Partial<PolygonFixture> = {},
): PolygonFixture => ({
  ...extra,
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
  let revisions: Model<Revision>;
  const polygon = new FakePolygon();
  let requesterId: string, groupId: string, otherGroupId: string;
  let typeId: string, otherLanguageId: string;

  /** A job as BullMQ hands it to the processor, recording the progress it reports and when it was delayed to; `timestamp` is when it was queued. */
  const runJob = async (
    data: PolygonImportJob,
    attempts = { attemptsMade: 0, opts: { attempts: 1 } },
    timestamp = Date.now(),
  ) => {
    const progress: ImportProgress[] = [];
    const delayedTo: number[] = [];
    const job = {
      moveToDelayed: (until: number) => {
        delayedTo.push(until);
        return Promise.resolve();
      },
      id: newId(),
      timestamp,
      data,
      ...attempts,
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
      (result) => ({ result, error: null, final: true, delayed: false }),
      (error: Error) => ({
        result: null,
        error: error.message,
        final: error instanceof UnrecoverableError,
        delayed: error instanceof DelayedError,
      }),
    );
    return {
      ...outcome,
      delayedTo,
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
    importTutorial: true,
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
    revisions = worker.module.get(getModelToken(Revision.name));
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
    const renamedId = newId();
    const renamedAway = await runJob({
      ...syncJob('never_linked', { packageId: 11, revision: 4 }, 99),
      problemId: renamedId,
    });
    const row = await runs.findOne({ jobId: renamedAway.jobId }).lean();
    expect(String(row?.problem)).toBe(renamedId);
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

  describe('settings edited on QHHOJ after the import', () => {
    const once = { attemptsMade: 0, opts: { attempts: 1 } };
    const syncTo = async (
      code: string,
      packageId: number,
      { timeLimitMs = 2000, overwriteLocalEdits = false } = {},
    ) => {
      const { dataVersion } = (await worker.problems.findOne({ code }))!;
      polygon.reply('problem.package', {
        zip: buildPolygonPackage(fixtureNamed(`Sum ${packageId}`, timeLimitMs)),
      });
      const job = syncJob(
        code,
        { packageId, revision: packageId },
        dataVersion,
      );
      return runJob(
        overwriteLocalEdits ? { ...job, overwriteLocalEdits } : job,
        once,
      );
    };
    const checkedOk = {
      file: 'checker.cpp',
      status: 'ok',
      log: '',
      checkedAt: new Date(0),
    };
    const problemOf = async (code: string) =>
      (await worker.problems
        .findOne({ code })
        .select('+data +sourceChecks'))!.toObject({
        getters: true,
      });

    it('keeps an edited time limit and reports it, takes the rest from the package, and restores it on request', async () => {
      await linked('tl_edit');
      await worker.problems.updateOne(
        { code: 'tl_edit' },
        { $set: { timeLimit: 4, 'sourceChecks.customChecker': checkedOk } },
      );
      const kept = await syncTo('tl_edit', 11);
      expect(kept.error).toBeNull();
      expect(kept.result?.localEdits).toEqual({
        kept: ['timeLimit'],
        updated: [],
      });
      expect(kept.result?.summary?.timeLimit).toEqual({
        polygon: 2,
        applied: 4,
      });
      const synced = await problemOf('tl_edit');
      expect(synced).toMatchObject({ name: 'Sum 11', timeLimit: 4 });
      // The package's checker replaced the checked file, so it is checked again.
      expect(synced.sourceChecks?.customChecker).toMatchObject({
        file: 'checker.cpp',
      });
      expect(synced.sourceChecks?.customChecker?.status).not.toBe('ok');
      const [revision] = await revisions
        .find({ entityId: (await problemOf('tl_edit'))._id, action: 'import' })
        .sort({ createdAt: -1, _id: -1 })
        .limit(1);
      expect(revision.comment).toMatch(/kept local timeLimit$/);

      const again = await syncTo('tl_edit', 12, { timeLimitMs: 3000 });
      expect(again.result?.localEdits).toEqual({
        kept: ['timeLimit'],
        updated: [],
      });
      expect((await problemOf('tl_edit')).timeLimit).toBe(4);

      const restored = await syncTo('tl_edit', 13, {
        timeLimitMs: 3000,
        overwriteLocalEdits: true,
      });
      expect(restored.result?.localEdits).toEqual({
        kept: [],
        updated: ['timeLimit'],
      });
      expect((await problemOf('tl_edit')).timeLimit).toBe(3);
      const next = await syncTo('tl_edit', 14, { timeLimitMs: 2000 });
      expect(next.result?.localEdits).toEqual({
        kept: [],
        updated: ['timeLimit'],
      });
      expect((await problemOf('tl_edit')).timeLimit).toBe(2);
    });

    it('keeps a checker uploaded under the imported name with its type and the local judging options, never overwriting the file', async () => {
      const before = await linked('chk_edit');
      const dataFiles = worker.module.get(ProblemDataFilesService);
      const checkerPath = dataFiles.pathOf('chk_edit', 'checker.cpp');
      await writeFile(checkerPath, "// the setter's themis checker");
      await worker.problems.updateOne(
        { code: 'chk_edit' },
        {
          $set: {
            'data.checkerArgs': { type: 'themis' },
            'data.unicode': true,
            'sourceChecks.customChecker': checkedOk,
          },
          $inc: { dataVersion: 1 },
        },
      );
      const { error, result } = await syncTo('chk_edit', 11);
      expect(error).toBeNull();
      expect(result?.localEdits).toEqual({
        kept: ['checker'],
        updated: ['timeLimit'],
      });
      const after = await problemOf('chk_edit');
      expect(after.data).toMatchObject({
        checker: 'bridged',
        checkerArgs: { type: 'themis' },
        customChecker: 'checker.cpp',
        unicode: true,
      });
      expect(after.sourceChecks?.customChecker).toMatchObject({
        status: 'ok',
      });
      expect(after.timeLimit).toBe(2);
      expect(after.dataVersion).toBe(before.dataVersion + 2);
      expect(await readFile(checkerPath, 'utf8')).toBe(
        "// the setter's themis checker",
      );
      expect(after.polygonLink).toMatchObject({
        packageId: 11,
        lastSyncResult: 'ok',
      });
    });

    it('moves an interactor-only problem with a record from before the interactive checker to running it, without an overwrite', async () => {
      const interactive = fixtureNamed('Sum', 1000, {
        interactor: 'files/interactor.cpp',
        resources: [{ path: 'files/testlib.h' }],
      });
      polygon.reply('problem.package', {
        zip: buildPolygonPackage(interactive),
      });
      expect((await runJob(linkJob('ic_legacy', 10))).error).toBeNull();
      // What an import before the interactive checker wrote (its checker ignored), and the record a later sync took of it.
      const linkedNow = await problemOf('ic_legacy');
      const dataFiles = worker.module.get(ProblemDataFilesService);
      const hashOf = async (name: string) =>
        sourceHashOf(await readFile(dataFiles.pathOf('ic_legacy', name)));
      const legacy = {
        timeLimit: linkedNow.timeLimit,
        memoryLimit: linkedNow.memoryLimit,
        partial: linkedNow.partial,
        data: {
          ...linkedNow.data!,
          checker: 'standard' as const,
          customChecker: null,
          interactiveChecker: false,
        },
      };
      const record = fingerprintsOf(
        {
          ...legacy,
          sourceHashes: {
            customChecker: null,
            customGrader: await hashOf('interactor.cpp'),
            helperHeaders: { 'testlib.h': await hashOf('testlib.h') },
          },
        },
        { withHeaders: false },
      );
      await worker.problems.updateOne(
        { code: 'ic_legacy' },
        {
          $set: {
            data: legacy.data,
            'polygonLink.importedSettings': record,
          },
          $inc: { dataVersion: 1 },
        },
      );
      polygon.reply('problem.package', {
        zip: buildPolygonPackage(interactive),
      });
      const { error, result } = await runJob(
        syncJob(
          'ic_legacy',
          { packageId: 11, revision: 11 },
          linkedNow.dataVersion + 1,
        ),
        once,
      );
      expect(error).toBeNull();
      expect(result?.localEdits).toEqual({
        kept: [],
        updated: ['checker', 'grader'],
      });
      expect((await problemOf('ic_legacy')).data).toMatchObject({
        interactiveChecker: true,
        customChecker: 'checker.cpp',
        helperHeaders: ['testlib.h'],
      });
      const init = parse(
        await readFile(dataFiles.pathOf('ic_legacy', 'init.yml'), 'utf8'),
      ) as { interactive?: { checker?: { name: string } } };
      expect(init.interactive?.checker).toMatchObject({ name: 'bridged' });
    });

    it("takes the package's interactor percent flag on a sync of an interactive problem linked without it", async () => {
      const interactive = (percent: boolean) =>
        buildPolygonPackage(
          fixtureNamed('Sum', 1000, {
            interactor: 'files/interactor.cpp',
            judging: { percent },
          }),
        );
      polygon.reply('problem.package', { zip: interactive(false) });
      expect((await runJob(linkJob('ip_sync', 10))).error).toBeNull();
      const { dataVersion } = await problemOf('ip_sync');
      polygon.reply('problem.package', { zip: interactive(true) });
      const { error, result } = await runJob(
        syncJob('ip_sync', { packageId: 11, revision: 11 }, dataVersion),
        once,
      );
      expect(error).toBeNull();
      expect(result?.localEdits).toEqual({
        kept: [],
        updated: ['checker', 'grader'],
      });
      expect((await problemOf('ip_sync')).data!.graderArgs).toEqual({
        treat_checker_points_as_percentage: true,
      });
    });

    it('keeps the headers a kept interactor compiles with when the package drops one, and leaves the checker unedited', async () => {
      const withHeaders = (...names: string[]) =>
        buildPolygonPackage(
          fixtureNamed('Sum', 1000, {
            interactor: 'files/interactor.cpp',
            resources: names.map((name) => ({ path: `files/${name}` })),
          }),
        );
      polygon.reply('problem.package', {
        zip: withHeaders('testlib.h', 'constraints.h'),
      });
      expect((await runJob(linkJob('hdr_kept', 10))).error).toBeNull();
      const dataFiles = worker.module.get(ProblemDataFilesService);
      await writeFile(
        dataFiles.pathOf('hdr_kept', 'interactor.cpp'),
        "// the setter's interactor",
      );
      const sync = async (packageId: number) => {
        const { dataVersion } = (await worker.problems.findOne({
          code: 'hdr_kept',
        }))!;
        polygon.reply('problem.package', { zip: withHeaders('testlib.h') });
        return runJob(
          syncJob('hdr_kept', { packageId, revision: packageId }, dataVersion),
          once,
        );
      };
      const first = await sync(11);
      expect(first.error).toBeNull();
      // The checker compiles with the same headers as before: nothing about it changed.
      expect(first.result?.localEdits).toEqual({
        kept: ['grader'],
        updated: [],
      });
      expect((await problemOf('hdr_kept')).data?.helperHeaders).toEqual([
        'testlib.h',
        'constraints.h',
      ]);
      expect(
        await readFile(dataFiles.pathOf('hdr_kept', 'constraints.h'), 'utf8'),
      ).toBe('// files/constraints.h');
      const init = parse(
        await readFile(dataFiles.pathOf('hdr_kept', 'init.yml'), 'utf8'),
      ) as { interactive?: { files?: string[] } };
      expect(init.interactive?.files).toEqual([
        'interactor.cpp',
        'testlib.h',
        'constraints.h',
      ]);
      // The link recorded the checker with the header set written: it does not read as edited (it would be kept with the grader).
      const again = await sync(12);
      expect(again.result?.localEdits).toEqual({
        kept: ['grader'],
        updated: [],
      });
    });

    it('reads the revisions since the last import for a link from before the record, then records it', async () => {
      const before = await linked('legacy');
      await worker.problems.updateOne(
        { code: 'legacy' },
        {
          $set: {
            'polygonLink.importedSettings': null,
            timeLimit: 4,
            memoryLimit: 131072,
          },
        },
      );
      await revisions.create({
        entity: 'problem',
        entityId: before._id,
        action: 'edit',
        userId: requesterId,
        changes: { timeLimit: { before: 1, after: 4 } },
      });
      const { result } = await syncTo('legacy', 11);
      expect(result?.localEdits).toEqual({
        kept: ['timeLimit'],
        updated: ['memoryLimit'],
      });
      const after = await problemOf('legacy');
      expect(after).toMatchObject({ timeLimit: 4, memoryLimit: 262144 });
      expect(
        Object.keys(after.polygonLink?.importedSettings ?? {}).sort(),
      ).toEqual([...SYNCED_SETTINGS].sort());
    });
  });

  it('ends a second sync of a package another sync already applied as ok, without downloading, and still repairs on a re-sync', async () => {
    const before = await linked('twice');
    polygon.reply('problem.package', {
      zip: buildPolygonPackage(fixtureNamed('Sum v2', 2000)),
    });
    const queued = syncJob(
      'twice',
      { packageId: 11, revision: 4 },
      before.dataVersion,
    );
    const queuedAt = Date.now() - 1000;
    const once = { attemptsMade: 0, opts: { attempts: 1 } };
    expect((await runJob(queued, once, queuedAt)).error).toBeNull();
    polygon.reset();
    const second = await runJob(queued, once, queuedAt);
    expect(second.error).toBeNull();
    expect(second.result).toEqual({
      problemId: String(before._id),
      code: 'twice',
    });
    expect(polygon.callsOf('problem.package')).toHaveLength(0);
    const after = (await worker.problems.findOne({ code: 'twice' }))!;
    expect(after.dataVersion).toBe(before.dataVersion + 1);
    expect(after.polygonLink).toMatchObject({
      packageId: 11,
      lastSyncResult: 'ok',
    });
    polygon.reply('problem.package', {
      zip: buildPolygonPackage(fixtureNamed('Sum v2', 2000)),
    });
    const repair = await runJob(
      syncJob('twice', { packageId: 11, revision: 4 }, after.dataVersion),
    );
    expect(repair.error).toBeNull();
    expect(polygon.callsOf('problem.package')).toHaveLength(1);
  });

  it('runs again, and fails visibly, a sync whose first run applied the package but never finished', async () => {
    const before = await linked('crashed');
    polygon.reply('problem.package', {
      zip: buildPolygonPackage(fixtureNamed('Sum v2', 2000)),
    });
    const queued = syncJob(
      'crashed',
      { packageId: 11, revision: 4 },
      before.dataVersion,
    );
    const queuedAt = Date.now() - 1000;
    const once = { attemptsMade: 0, opts: { attempts: 1 } };
    expect((await runJob(queued, once, queuedAt)).error).toBeNull();
    // The worker stopped after the write, before the run was recorded.
    await runs.deleteMany({ code: 'crashed', packageId: 11 });
    polygon.reply('problem.package', {
      zip: buildPolygonPackage(fixtureNamed('Sum v2', 2000)),
    });
    const rerun = await runJob(queued, once, queuedAt);
    expect(rerun.result).toBeNull();
    expect(
      (await worker.problems.findOne({ code: 'crashed' }))!.polygonLink,
    ).toMatchObject({
      lastSyncResult: 'failed',
      lastSyncErrorCode: 'problem_changed',
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
    const { error, failedStep, jobId } = await runJob({
      ...syncJob('broken', { packageId: 12, revision: 5 }, before.dataVersion),
      problemId: String(before._id),
    });
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
      errorCode: 'polygon_failed',
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
      lastSyncErrorCode: 'polygon_failed',
      lastSyncError:
        'Polygon: problem.package for package 12 of problem 4242 (type linux): packageId: Package is not full',
      lastSyncPackageId: 12,
    });
  });

  it('leaves an outage to the queue retry while attempts are left, then records it with its code', async () => {
    const before = await linked('outage');
    const imports = worker.module.get(PolygonImportService);
    const outage = () =>
      jest
        .spyOn(imports, 'import')
        .mockRejectedValueOnce(
          new PolygonImportError(
            'Polygon: Polygon did not answer problem.package: ECONNRESET',
            'polygon_unavailable',
          ),
        );
    const queued = syncJob(
      'outage',
      { packageId: 11, revision: 4 },
      before.dataVersion,
    );
    outage();
    const first = await runJob(queued, {
      attemptsMade: 0,
      opts: { attempts: 2 },
    });
    expect(first).toMatchObject({ final: false, failedStep: undefined });
    expect(await runs.countDocuments({ jobId: first.jobId })).toBe(0);
    expect(
      (await worker.problems.findOne({ code: 'outage' }))!.polygonLink,
    ).toMatchObject({ lastSyncResult: 'ok' });
    outage();
    const last = await runJob(queued, {
      attemptsMade: 1,
      opts: { attempts: 2 },
    });
    expect(last).toMatchObject({
      final: true,
      error: `${POLYGON_ERROR_PREFIX}Polygon: Polygon did not answer problem.package: ECONNRESET`,
    });
    expect(
      (await worker.problems.findOne({ code: 'outage' }))!.polygonLink,
    ).toMatchObject({
      lastSyncResult: 'failed',
      lastSyncErrorCode: 'polygon_unavailable',
    });
    jest.restoreAllMocks();
  });

  it('records on the link a sync that imported but needs a repair, while the job completes', async () => {
    const before = await linked('repair');
    const checkerCheck = async () =>
      (await worker.problems
        .findOne({ code: 'repair' }, { sourceChecks: 1 })
        .lean())!.sourceChecks?.customChecker;
    // The link's own check (no judge here: unavailable) lands first, so it cannot answer the sync's.
    await waitUntil(async () => (await checkerCheck())?.status !== 'pending');
    await worker.problems.updateOne(
      { code: 'repair' },
      {
        $set: {
          'sourceChecks.customChecker': {
            file: 'checker.cpp',
            status: 'ok',
            log: '',
            checkedAt: new Date(0),
          },
        },
      },
    );
    polygon.reply('problem.package', {
      zip: buildPolygonPackage(fixtureNamed('Sum v2', 2000)),
    });
    const failing = jest
      .spyOn(worker.module.get(ProblemDataFilesService), 'writeInit')
      .mockRejectedValueOnce(new Error('EACCES'));
    const { result, error, jobId } = await runJob(
      syncJob('repair', { packageId: 11, revision: 4 }, before.dataVersion),
    );
    failing.mockRestore();
    expect(error).toBeNull();
    expect(result?.attention?.code).toBe('imported_needs_attention');
    expect(
      (await worker.problems.findOne({ code: 'repair' }))!.toObject({
        getters: true,
      }),
    ).toMatchObject({
      name: 'Sum v2',
      polygonLink: {
        packageId: 11,
        lastSyncResult: 'failed',
        lastSyncErrorCode: 'imported_needs_attention',
      },
    });
    expect(await runs.findOne({ jobId }).lean()).toMatchObject({
      result: 'failed',
      failedStep: 'finishing',
      errorCode: 'imported_needs_attention',
    });
    // The commit replaced the checker: the old file's ok is gone with it, though nothing was compiled.
    expect(await checkerCheck()).toMatchObject({
      file: 'checker.cpp',
      status: 'pending',
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

  it('records a refused sync of a renamed, unlinked problem on that problem, never on a new problem relinked to the same Polygon problem', async () => {
    const original = await linked('renamed_src', 10);
    await worker.problems.updateOne(
      { _id: original._id },
      { $set: { code: 'renamed_moved', polygonLink: null } },
    );
    const relinked = await linked('renamed_src', 10);
    try {
      polygon.reset();
      const { error, jobId } = await runJob({
        ...syncJob(
          'renamed_src',
          { packageId: 11, revision: 4 },
          original.dataVersion,
        ),
        problemId: String(original._id),
      });
      expect(error).toContain('was renamed since the import was queued');
      expect(polygon.calls).toEqual([]);
      const run = await runs.findOne({ jobId }).lean();
      expect(String(run?.problem)).toBe(String(original._id));
      const link = (await worker.problems.findById(relinked._id).lean())!
        .polygonLink;
      expect(link).toMatchObject({ lastSyncResult: 'ok' });
      expect(link?.lastSyncPackageId).not.toBe(11);
    } finally {
      await worker.problems.deleteMany({
        code: { $in: ['renamed_src', 'renamed_moved'] },
      });
    }
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
      const job = await imports.getJob(syncJobId(problem._id, 20));
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
          await imports.getJob(syncJobId(problem._id, 30)),
        ).toBeUndefined();
    });

    it('holds a sync queued before a contest started until the contest ends, recording nothing, then applies it', async () => {
      const problem = await linked('auto_race');
      const contest = await seedContest(worker, {
        startTime: new Date(Date.now() + 5 * 60_000),
        problems: [{ problem: problem._id, points: 100, order: 0 }],
      } as never);
      polygon.reply('problem.packages', {
        result: [ready(10, 3), ready(20, 6)],
      });
      await autoSync.run();
      const queued = (await imports.getJob(syncJobId(problem._id, 20)))!;
      polygon.reply('problem.package', {
        zip: buildPolygonPackage(fixtureNamed('Sum v2', 3000)),
      });
      // The contest starts after the download, before the write.
      whileReading = () =>
        worker.contests.updateOne(
          { _id: contest._id },
          { $set: { startTime: new Date(Date.now() - 60_000) } },
        );
      const held = await runJob(queued.data);
      expect(held).toMatchObject({ delayed: true, final: false });
      expect(held.delayedTo).toEqual([contest.endTime.getTime()]);
      const during = (await worker.problems.findOne({ code: 'auto_race' }))!;
      expect(during).toMatchObject({ name: 'Sum', timeLimit: 1 });
      expect(during.polygonLink).toMatchObject({ packageId: 10 });
      expect(during.polygonLink?.lastSyncResult).not.toBe('failed');
      expect(await runs.countDocuments({ jobId: held.jobId })).toBe(0);
      // Woken while the contest still runs, it waits again without downloading.
      const downloads = polygon.callsOf('problem.package').length;
      expect((await runJob(queued.data)).delayed).toBe(true);
      expect(polygon.callsOf('problem.package')).toHaveLength(downloads);

      await worker.contests.updateOne(
        { _id: contest._id },
        { $set: { endTime: new Date(Date.now() - 1000) } },
      );
      expect((await runJob(queued.data)).error).toBeNull();
      expect(
        await worker.problems.findOne({ code: 'auto_race' }),
      ).toMatchObject({ name: 'Sum v2', timeLimit: 3 });
    });

    it('holds a sync of a root while a contest runs one of its mirrors', async () => {
      const problem = await linked('auto_root');
      const mirror = await seedProblem(worker, {
        code: 'auto_mirror',
        mirrorOf: problem._id,
        mirrorRoot: problem._id,
      });
      const contest = await seedContest(worker, {
        problems: [{ problem: mirror._id, points: 100, order: 0 }],
      } as never);
      const sync = syncJob(
        'auto_root',
        { packageId: 20, revision: 6 },
        problem.dataVersion,
      );
      const held = await runJob({
        ...sync,
        polygon: { ...sync.polygon!, trigger: 'auto' as const },
      });
      expect(held.delayedTo).toEqual([contest.endTime.getTime()]);
      expect(
        await worker.problems.findOne({ code: 'auto_root' }),
      ).toMatchObject({ name: 'Sum', timeLimit: 1 });
    });

    it('fails an automatic sync still held by a contest a week after it was queued, recording why', async () => {
      const problem = await linked('auto_week');
      await seedContest(worker, {
        problems: [{ problem: problem._id, points: 100, order: 0 }],
      } as never);
      const sync = syncJob(
        'auto_week',
        { packageId: 20, revision: 6 },
        problem.dataVersion,
      );
      const job = {
        ...sync,
        polygon: { ...sync.polygon!, trigger: 'auto' as const },
      };
      const once = { attemptsMade: 0, opts: { attempts: 1 } };
      const day = 86_400_000;
      const queuedAt = Date.now() - 7 * day + 60_000;
      const capped = await runJob(job, once, queuedAt);
      expect(capped.delayedTo).toEqual([queuedAt + 7 * day]);
      const failed = await runJob(job, once, Date.now() - 7 * day);
      expect(failed).toMatchObject({ final: true, delayed: false });
      expect(
        (await worker.problems.findOne({ code: 'auto_week' }))!.polygonLink,
      ).toMatchObject({
        packageId: 10,
        lastSyncResult: 'failed',
        lastSyncErrorCode: 'problem_in_running_contest',
      });
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
