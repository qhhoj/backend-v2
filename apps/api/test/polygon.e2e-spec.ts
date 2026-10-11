import { getQueueToken } from '@nestjs/bullmq';
import { getModelToken } from '@nestjs/mongoose';
import { Worker } from 'bullmq';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import type { Model } from 'mongoose';
import { REDIS } from '@libs/common';
import { waitUntil } from '@libs/common/testing';
import { newId, PolygonSyncRun } from '@libs/database';
import type { PolygonLink } from '@libs/database';
import {
  POLYGON_ERROR_PREFIX,
  POLYGON_FETCH,
  POLYGON_QUEUE,
} from '@libs/problems';
import type { PolygonImportJob } from '@libs/problems';
import { FakePolygon } from '@libs/problems/testing';
import {
  authed,
  createProblem,
  createUserWith,
  loginAs,
  seedCatalog,
} from './problem-fixtures';
import type { Catalog, TestSession } from './problem-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';

const POLYGON = '/api/internal/polygon';
const linkOf = (problemId: number, extra: Partial<PolygonLink> = {}) => ({
  problemId,
  name: `p${problemId}`,
  owner: 'setter',
  revision: 3,
  packageId: 10,
  linkedAt: new Date(),
  linkedBy: '0192b0e0-0000-7000-8000-000000000001',
  lastSyncAt: new Date(),
  lastSyncResult: 'ok',
  lastSyncError: null,
  lastSyncPackageId: 10,
  autoSync: false,
  options: {
    mainStatementLanguage: 'english',
    statementLanguages: { vietnamese: 'vi' },
    tutorialLanguage: null,
    ignoreZeroPointBatches: false,
    ignoreZeroPointCases: false,
    appendMainSolution: true,
    maxCases: 300,
  },
  ...extra,
});
const BUILT_AT = '2026-10-01T08:00:00.000Z';
const pkg = (id: number, revision: number, state: string) => ({
  id,
  revision,
  state,
  creationTimeSeconds: Date.parse(BUILT_AT) / 1000,
});
const API_KEY = 'polygon-key-7f3a';
const dataOf = <Data>({ body }: { body: unknown }) =>
  (body as { data: Data }).data;

describe('Polygon routes', () => {
  let api: ApiTest;
  let catalog: Catalog;
  let queue: Queue<PolygonImportJob>;
  let redis: Redis;
  let runs: Model<PolygonSyncRun>;
  const polygon = new FakePolygon();
  let importer: TestSession, admin: TestSession, plain: TestSession;
  let importerId: string;

  const sharedProblems = () =>
    polygon
      .reply('problems.list', ({ id }) => ({
        result: [
          { id: 1, name: 'sum', owner: 'alice', revision: 3, latestPackage: 3 },
          { id: 2, name: 'graph', owner: 'bob', revision: 5, modified: true },
          { id: 3, name: 'none', owner: 'bob', revision: 1 },
          { id: 4, name: 'gone', owner: 'bob', revision: 1, deleted: true },
        ].filter((problem) => !id || String(problem.id) === id),
      }))
      .reply('problem.packages', ({ problemId }) => ({
        result:
          {
            '1': [pkg(10, 3, 'READY')],
            '2': [pkg(20, 4, 'READY'), pkg(21, 5, 'PENDING')],
            '3': [],
          }[problemId] ?? [],
      }))
      .reply('problem.statements', ({ problemId }) => ({
        result:
          problemId === '1'
            ? { english: { name: 'Sum' }, vietnamese: { name: 'Tổng' } }
            : {},
      }));
  const get = (path: string, session = importer) =>
    authed(api.http().get(path), session);
  const post = (path: string, body: object = {}, session = importer) =>
    authed(api.http().post(path), session).send(body);

  beforeAll(async () => {
    api = await setupApiTest({
      overrides: [{ provide: POLYGON_FETCH, useValue: polygon.fetch }],
    });
    catalog = await seedCatalog(api);
    queue = api.app.get(getQueueToken(POLYGON_QUEUE));
    redis = api.app.get(REDIS);
    runs = api.app.get(getModelToken(PolygonSyncRun.name));
    importerId = (
      await createUserWith(api, 'importer', {
        permissions: [
          'judge.import_polygon_package',
          'judge.add_problem',
          'judge.edit_own_problem',
        ],
      })
    )._id;
    importer = await loginAs(api, importerId);
    admin = await loginAs(
      api,
      (
        await createUserWith(api, 'admin', {
          permissions: ['judge.change_settings'],
        })
      )._id,
    );
    plain = await loginAs(api, (await createUserWith(api, 'plain'))._id);
    await api.setSetting('polygon.apiKey', API_KEY);
    await api.setSetting('polygon.apiSecret', 'SECRET');
    await api.setSetting('polygon.accountName', 'qhhoj');
  });
  beforeEach(async () => {
    polygon.reset();
    await redis.del('polygon:problems');
    await queue.drain(true);
    // Every test links the problems it needs.
    await api.problems.updateMany({}, { $set: { polygonLink: null } });
  });
  afterAll(() => api.teardown());

  it('refuses every route without the permission', async () => {
    await get(`${POLYGON}/status`, plain).expect(403);
    await get(`${POLYGON}/problems`, plain).expect(403);
    await post(`${POLYGON}/problems/1/import`, { code: 'x' }, plain).expect(
      403,
    );
    await post(`${POLYGON}/test`, {}, importer).expect(403);
    await post('/api/internal/problems/any/polygon/sync', {}, plain).expect(
      403,
    );
    await authed(api.http().patch('/api/internal/problems/any/polygon'), plain)
      .send({ autoSync: true })
      .expect(403);
    await authed(
      api.http().delete('/api/internal/problems/any/polygon'),
      plain,
    ).expect(403);
    expect(polygon.calls).toEqual([]);
  });

  it('reports the connection without calling Polygon and never returns the key or the secret', async () => {
    expect(dataOf(await get(`${POLYGON}/status`).expect(200))).toEqual({
      connected: true,
      accountName: 'qhhoj',
    });
    const settings = dataOf<
      Array<{ key: string; value: unknown; hasSecret: boolean }>
    >(await get('/api/internal/admin/settings', admin).expect(200));
    expect(JSON.stringify(settings)).not.toMatch(/SECRET|polygon-key-7f3a/);
    for (const key of ['polygon.apiKey', 'polygon.apiSecret'])
      expect(settings.find((row) => row.key === key)).toMatchObject({
        hasSecret: true,
        value: { set: true },
      });
    const revisions = await get(
      '/api/internal/admin/settings/polygon.apiKey/revisions',
      admin,
    ).expect(200);
    expect(JSON.stringify(revisions.body)).not.toContain(API_KEY);
    expect(polygon.calls).toEqual([]);
  });

  it('tests the connection for settings staff and maps Polygon refusals', async () => {
    sharedProblems();
    expect(
      dataOf(await post(`${POLYGON}/test`, {}, admin).expect(200)),
    ).toEqual({
      ok: true,
      problemCount: 4,
    });
    polygon.reply('problems.list', { failed: 'Incorrect signature' });
    await post(`${POLYGON}/test`, {}, admin)
      .expect(502)
      .expect(errorCode('polygon_unauthorized'));
    polygon.reply('problems.list', { failed: 'time: Wrong time' });
    await post(`${POLYGON}/test`, {}, admin)
      .expect(502)
      .expect(errorCode('polygon_clock_skew'));
    polygon.reply('problems.list', { status: 502 });
    await post(`${POLYGON}/test`, {}, admin)
      .expect(503)
      .expect(errorCode('polygon_unavailable'));
  });

  it('lists shared problems with package state, title and linked code, and caches the list', async () => {
    sharedProblems();
    await createProblem(api, catalog, {
      code: 'linked_sum',
      polygonLink: linkOf(1) as never,
    });
    const listed = dataOf<Array<Record<string, unknown>>>(
      await get(`${POLYGON}/problems`).expect(200),
    );
    expect(listed).toEqual([
      {
        id: 1,
        name: 'sum',
        title: 'Tổng',
        owner: 'alice',
        revision: 3,
        modified: false,
        latestPackage: {
          id: 10,
          revision: 3,
          state: 'READY',
          createdAt: BUILT_AT,
        },
        linkedProblemCode: 'linked_sum',
      },
      {
        id: 2,
        name: 'graph',
        title: null,
        owner: 'bob',
        revision: 5,
        modified: true,
        latestPackage: {
          id: 21,
          revision: 5,
          state: 'RUNNING',
          createdAt: BUILT_AT,
        },
        linkedProblemCode: null,
      },
      expect.objectContaining({
        id: 3,
        latestPackage: {
          id: null,
          revision: null,
          state: 'NONE',
          createdAt: null,
        },
      }),
    ]);
    const callsAfterFirst = polygon.calls.length;
    const filtered = dataOf<Array<{ id: number }>>(
      await get(`${POLYGON}/problems?search=TỔNG&state=READY`).expect(200),
    );
    expect(filtered.map(({ id }) => id)).toEqual([1]);
    expect(polygon.calls.length).toBe(callsAfterFirst);
    await get(`${POLYGON}/problems?refresh=true`).expect(200);
    expect(polygon.callsOf('problems.list')).toHaveLength(2);
    // Titles are cached per revision, so the refresh does not ask for them again.
    expect(polygon.callsOf('problem.statements')).toHaveLength(3);
  });

  it('answers not connected without calling Polygon while the secret is unset', async () => {
    await api.setSetting('polygon.apiSecret', '');
    try {
      expect(dataOf(await get(`${POLYGON}/status`).expect(200))).toMatchObject({
        connected: false,
      });
      await get(`${POLYGON}/problems`)
        .expect(409)
        .expect(errorCode('polygon_not_connected'));
      expect(polygon.calls).toEqual([]);
    } finally {
      await api.setSetting('polygon.apiSecret', 'SECRET');
    }
  });

  it('queues an import of the newest READY package with the zip import options and the link', async () => {
    sharedProblems();
    const response = await post(`${POLYGON}/problems/1/import`, {
      code: 'from_polygon',
      points: 900,
      groupId: catalog.groups.voi,
      statementLanguages: ['vietnamese=vi'],
      mainStatementLanguage: 'english',
      autoSync: true,
    }).expect(202);
    const job = await queue.getJob(dataOf<{ jobId: string }>(response).jobId);
    expect(job?.data).toMatchObject({
      requesterId: importerId,
      code: 'from_polygon',
      mode: 'create',
      points: 900,
      groupId: catalog.groups.voi,
      statementLanguages: { vietnamese: 'vi' },
      polygon: {
        problemId: 1,
        name: 'sum',
        owner: 'alice',
        revision: 3,
        packageId: 10,
        packageCreatedAt: BUILT_AT,
        purpose: 'link',
        autoSync: true,
        trigger: 'manual',
      },
    });
    const status = dataOf<{ step: string; progress: unknown }>(
      await get(`/api/internal/problems/imports/${job!.id}`).expect(200),
    );
    expect(status).toMatchObject({
      step: 'queued',
      progress: null,
      failedStep: null,
    });
    await job!.updateProgress({ step: 'downloading', done: 5, total: 10 });
    expect(
      dataOf(
        await get(`/api/internal/problems/imports/${job!.id}`).expect(200),
      ),
    ).toMatchObject({
      step: 'downloading',
      progress: { step: 'downloading', done: 5, total: 10 },
    });
  });

  it('answers where a failed import stopped, with the error written for the requester', async () => {
    const worker = new Worker<PolygonImportJob>(
      POLYGON_QUEUE,
      async (job) => {
        await job.updateData({ ...job.data, failedStep: 'statements' });
        throw new Error(`${POLYGON_ERROR_PREFIX}statement.tex is missing`);
      },
      { connection: queue.opts.connection },
    );
    try {
      sharedProblems();
      const { jobId } = dataOf<{ jobId: string }>(
        await post(`${POLYGON}/problems/1/import`, {
          code: 'fails_polygon',
        }).expect(202),
      );
      await waitUntil(
        async () => (await queue.getJob(jobId))?.failedReason !== undefined,
        15_000,
      );
      expect(
        dataOf(
          await get(`/api/internal/problems/imports/${jobId}`).expect(200),
        ),
      ).toMatchObject({
        state: 'failed',
        step: 'failed',
        failedStep: 'statements',
        error: 'statement.tex is missing',
      });
    } finally {
      await worker.close();
    }
  });

  it('refuses an import whose newest package is not READY, an already linked problem and an unshared one', async () => {
    sharedProblems();
    await post(`${POLYGON}/problems/2/import`, { code: 'graph_one' })
      .expect(409)
      .expect(errorCode('polygon_package_not_ready'));
    await post(`${POLYGON}/problems/3/import`, { code: 'none_one' })
      .expect(409)
      .expect(errorCode('polygon_package_not_ready'));
    await createProblem(api, catalog, {
      code: 'taken_link',
      polygonLink: linkOf(1) as never,
    });
    await post(`${POLYGON}/problems/1/import`, { code: 'second_link' })
      .expect(409)
      .expect(errorCode('polygon_already_linked'));
    await post(`${POLYGON}/problems/99/import`, { code: 'unshared' })
      .expect(404)
      .expect(errorCode('not_found'));
    expect(await queue.count()).toBe(0);
  });

  it('lists the sync history per problem for its editors, and overall only with judge.edit_all_problem', async () => {
    const mine = await createProblem(api, catalog, {
      code: 'history_mine',
      authors: [importerId],
    });
    const other = await createProblem(api, catalog, { code: 'history_other' });
    const run = (problem: string, extra: Partial<PolygonSyncRun> = {}) => ({
      _id: newId(),
      problem,
      code: problem === mine._id ? 'history_mine' : 'history_other',
      polygonProblemId: 7,
      polygonName: 'sum',
      revision: 3,
      packageId: 10,
      packageCreatedAt: new Date(BUILT_AT),
      purpose: 'sync',
      trigger: 'manual',
      requestedBy: importerId,
      jobId: newId(),
      result: 'ok',
      ...extra,
    });
    await runs.create(run(mine._id));
    await runs.create(run(other._id));
    await runs.create(
      run(mine._id, {
        revision: 4,
        trigger: 'auto',
        result: 'failed',
        failedStep: 'tests',
        error: 'too many tests',
      }),
    );
    const page = await get(
      '/api/internal/problems/history_mine/polygon/syncs?pageSize=1',
    ).expect(200);
    expect((page.body as { meta: unknown }).meta).toMatchObject({
      page: 1,
      pageSize: 1,
      total: 2,
    });
    expect(dataOf(page)).toEqual([
      expect.objectContaining({
        problemId: mine._id,
        code: 'history_mine',
        revision: 4,
        packageCreatedAt: BUILT_AT,
        trigger: 'auto',
        requestedBy: expect.objectContaining({
          username: 'importer',
        }) as unknown,
        result: 'failed',
        failedStep: 'tests',
        error: 'too many tests',
      }),
    ]);
    await get('/api/internal/problems/history_other/polygon/syncs')
      .expect(403)
      .expect(errorCode('forbidden'));
    await get(`${POLYGON}/syncs`).expect(403).expect(errorCode('forbidden'));
    const auditor = await loginAs(
      api,
      (
        await createUserWith(api, 'auditor', {
          permissions: [
            'judge.import_polygon_package',
            'judge.edit_all_problem',
          ],
        })
      )._id,
    );
    const all = dataOf<Array<{ code: string }>>(
      await get(`${POLYGON}/syncs`, auditor).expect(200),
    );
    expect(all.map(({ code }) => code)).toEqual(
      expect.arrayContaining(['history_mine', 'history_other']),
    );
  });

  describe('a linked problem', () => {
    let code: string;
    let counter = 0;

    beforeEach(async () => {
      code = `linked_${(counter += 1)}`;
      await createProblem(api, catalog, {
        code,
        authors: [importerId],
        points: 1500,
        dataVersion: 4,
        polygonLink: linkOf(100 + counter) as never,
      });
    });
    const links = () => `/api/internal/problems/${code}/polygon`;

    it('syncs the newest READY package as an update that names no QHHOJ-owned field', async () => {
      polygon.reply('problem.packages', {
        result: [pkg(10, 3, 'READY'), pkg(11, 4, 'READY')],
      });
      const response = await post(`${links()}/sync`).expect(202);
      const job = await queue.getJob(dataOf<{ jobId: string }>(response).jobId);
      expect(job?.data).toMatchObject({
        code,
        mode: 'update',
        requesterId: importerId,
        expectedDataVersion: 4,
        mainStatementLanguage: 'english',
        statementLanguages: { vietnamese: 'vi' },
        appendMainSolution: true,
        polygon: { packageId: 11, revision: 4, purpose: 'sync' },
      });
      for (const field of [
        'points',
        'groupId',
        'typeIds',
        'authors',
        'curators',
      ])
        expect(job?.data).not.toHaveProperty(field);
    });

    it('refuses a sync while the newest package is still building', async () => {
      polygon.reply('problem.packages', {
        result: [pkg(10, 3, 'READY'), pkg(11, 4, 'RUNNING')],
      });
      await post(`${links()}/sync`)
        .expect(409)
        .expect(errorCode('polygon_package_not_ready'));
    });

    it('shows the link with the newest package, switches auto-sync and unlinks, writing revisions', async () => {
      polygon.reply('problem.packages', { result: [pkg(11, 4, 'READY')] });
      expect(dataOf(await get(links()).expect(200))).toMatchObject({
        link: {
          revision: 3,
          packageId: 10,
          autoSync: false,
          lastSyncResult: 'ok',
        },
        latestPackage: { id: 11, revision: 4, state: 'READY' },
      });
      expect(
        dataOf(
          await authed(api.http().patch(links()), importer)
            .send({ autoSync: true })
            .expect(200),
        ),
      ).toMatchObject({ autoSync: true });
      await authed(api.http().delete(links()), importer).expect(204);
      const problem = await api.problems.findOne({ code });
      expect(problem!.polygonLink).toBeNull();
      expect(problem!.points).toBe(1500);
      const revisions = await api.revisions
        .find({ entityId: problem!._id, action: 'polygon_link' })
        .sort({ createdAt: 1 });
      expect(
        revisions.map((revision) => Object.keys(revision.changes)),
      ).toEqual([['polygonLink.autoSync'], ['polygonLink']]);
      await get(links()).expect(404).expect(errorCode('polygon_not_linked'));
    });

    it('shows the title and build time of the synced package and the build time of the newest one', async () => {
      await api.problems.updateOne(
        { code },
        {
          $set: {
            'polygonLink.title': 'Tổng',
            'polygonLink.packageCreatedAt': new Date(BUILT_AT),
          },
        },
      );
      polygon.reply('problem.packages', { result: [pkg(11, 4, 'READY')] });
      expect(dataOf(await get(links()).expect(200))).toMatchObject({
        link: { title: 'Tổng', packageCreatedAt: BUILT_AT },
        latestPackage: { id: 11, createdAt: BUILT_AT },
      });
    });

    it('still shows the link when Polygon cannot be asked', async () => {
      polygon.reply('problem.packages', { status: 503 });
      expect(dataOf(await get(links()).expect(200))).toMatchObject({
        latestPackage: null,
      });
    });
  });
});
