import { getQueueToken } from '@nestjs/bullmq';
import { getModelToken } from '@nestjs/mongoose';
import { Worker } from 'bullmq';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import type { Model } from 'mongoose';
import { REDIS } from '@libs/common';
import { waitUntil } from '@libs/common/testing';
import { newId, PolygonSyncRun, uuidStr } from '@libs/database';
import type { PolygonLink } from '@libs/database';
import {
  POLYGON_ERROR_PREFIX,
  POLYGON_FETCH,
  POLYGON_QUEUE,
} from '@libs/problems';
import type { PolygonImportJob } from '@libs/problems';
import { buildZip, FakePolygon } from '@libs/problems/testing';
import { POLYGON_LINK_LIMIT } from '../src/modules/problems/core/rate-limits';
import {
  authed,
  createProblem,
  createUserWith,
  loginAs,
  seedCatalog,
} from './problem-fixtures';
import type { Catalog, TestSession } from './problem-fixtures';
import { createOrganization } from './organization-fixtures';
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
/** A full package's Linux row: the variant an import downloads. */
const pkg = (id: number, revision: number, state: string, type = 'linux') => ({
  id,
  revision,
  state,
  type,
  creationTimeSeconds: Date.parse(BUILT_AT) / 1000,
});
const API_KEY = 'polygon-key-7f3a';
const SHARED = [
  { id: 1, name: 'sum', owner: 'alice', revision: 3, latestPackage: 3 },
  { id: 2, name: 'graph', owner: 'bob', revision: 5, modified: true },
  { id: 3, name: 'none', owner: 'bob', revision: 1 },
  { id: 4, name: 'gone', owner: 'bob', revision: 1, deleted: true },
];
/** The `p…` token each problem's packages record. */
const TOKENS: Record<string, string> = { '1': 'p1Sum00', '2': 'p2Graph' };
const linkTo = (owner: string, name: string, token: string) =>
  `https://polygon.codeforces.com/${token}/${owner}/${name}`;
const SUM_LINK = linkTo('alice', 'sum', TOKENS['1']);
/** A package whose problem.xml records `token` in its url (no url when undefined). */
const packageRecording = (token: string | undefined) =>
  buildZip([
    {
      name: 'problem.xml',
      content: token
        ? `<problem revision="3" url="${linkTo('alice', 'sum', token)}"/>`
        : '<problem revision="3"/>',
    },
  ]);
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

  /** Problem 1 `alice/sum` (full package READY), 2 `bob/graph` (newer build running), 3 `bob/none` (no package), 4 deleted. */
  const sharedProblems = () =>
    polygon
      .reply('problems.list', ({ id, owner, name }) => ({
        result: SHARED.filter(
          (problem) =>
            (!id || String(problem.id) === id) &&
            (!owner || problem.owner === owner) &&
            (!name || problem.name === name),
        ),
      }))
      .reply('problem.packages', ({ problemId }) => ({
        result:
          {
            '1': [pkg(10, 3, 'READY'), pkg(10, 3, 'READY', 'standard')],
            '2': [pkg(20, 4, 'READY'), pkg(21, 5, 'PENDING')],
            '3': [],
          }[problemId] ?? [],
      }))
      .reply('problem.package', ({ problemId }) => ({
        zip: packageRecording(TOKENS[problemId]),
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
          'judge.sync_polygon_problem',
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
    const cached = [
      ...(await redis.keys('polygon:link-token:*')),
      ...(await redis.keys('rate:polygon-link:*')),
    ];
    if (cached.length) await redis.del(...cached);
    await queue.drain(true);
    // Every test links the problems it needs.
    await api.problems.updateMany({}, { $set: { polygonLink: null } });
  });
  afterAll(() => api.teardown());

  it('refuses every route without the creation rights or the sync permission', async () => {
    await get(`${POLYGON}/status`, plain).expect(403);
    await post(`${POLYGON}/resolve`, { link: SUM_LINK }, plain).expect(403);
    await post(
      `${POLYGON}/import`,
      { link: SUM_LINK, code: 'x' },
      plain,
    ).expect(403);
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

  describe('a pasted link', () => {
    const resolve = (link: string, session = importer) =>
      post(`${POLYGON}/resolve`, { link }, session);
    const refusalOf = ({ body }: { body: unknown }) =>
      (body as { error: Record<string, unknown> }).error;

    it('previews the problem when the token matches its newest package, reading the package once', async () => {
      sharedProblems();
      const preview = dataOf(await resolve(SUM_LINK).expect(200));
      expect(preview).toEqual({
        id: 1,
        name: 'sum',
        owner: 'alice',
        title: 'Tổng',
        revision: 3,
        modified: false,
        latestPackage: {
          id: 10,
          revision: 3,
          state: 'READY',
          type: 'full',
          createdAt: BUILT_AT,
        },
      });
      expect(polygon.callsOf('problems.list')[0].params).toMatchObject({
        owner: 'alice',
        name: 'sum',
      });
      expect(polygon.callsOf('problem.package')).toEqual([
        {
          method: 'problem.package',
          params: expect.objectContaining({
            problemId: '1',
            packageId: '10',
            type: 'standard',
          }) as unknown,
        },
      ]);
      await resolve(`${SUM_LINK}/`).expect(200);
      expect(polygon.callsOf('problem.package')).toHaveLength(1);
      expect(await redis.get('polygon:link-token:1')).not.toContain(
        TOKENS['1'],
      );
    });

    it('answers a wrong token and a problem not shared with the account with the same refusal', async () => {
      sharedProblems();
      const wrongToken = refusalOf(
        await resolve(linkTo('alice', 'sum', 'pWrong1')).expect(404),
      );
      const unshared = refusalOf(
        await resolve(linkTo('carol', 'secret', 'pWrong1')).expect(404),
      );
      expect(wrongToken).toMatchObject({ code: 'polygon_link_refused' });
      expect(unshared).toEqual(wrongToken);
      // The token read from the package is kept, so another guess downloads nothing.
      await resolve(linkTo('alice', 'sum', 'pWrong2'))
        .expect(404)
        .expect(errorCode('polygon_link_refused'));
      expect(polygon.callsOf('problem.package')).toHaveLength(1);
      await resolve(SUM_LINK).expect(200);
    });

    it('refuses a link it cannot check: a problem.xml without a url', async () => {
      sharedProblems().reply('problem.package', {
        zip: packageRecording(undefined),
      });
      await resolve(SUM_LINK)
        .expect(404)
        .expect(errorCode('polygon_link_refused'));
    });

    it('refuses a malformed link before asking Polygon', async () => {
      sharedProblems();
      for (const link of [
        'https://polygon.codeforces.com.evil.io/p1Sum00/alice/sum',
        'http://polygon.codeforces.com/p1Sum00/alice/sum',
        'https://polygon.codeforces.com/alice/sum',
      ])
        await resolve(link)
          .expect(400)
          .expect(errorCode('polygon_link_invalid'));
      await post(`${POLYGON}/resolve`, {}).expect(400);
      expect(polygon.calls).toEqual([]);
    });

    it('asks for a package when there is none or the newest is not READY (be#47), and offers a standard one', async () => {
      sharedProblems();
      await resolve(linkTo('bob', 'none', 'p3None0'))
        .expect(409)
        .expect(errorCode('polygon_no_package'));
      await resolve(linkTo('bob', 'graph', TOKENS['2']))
        .expect(409)
        .expect(errorCode('polygon_package_not_ready'));
      polygon.reply('problem.packages', {
        result: [pkg(30, 3, 'READY', 'standard')],
      });
      expect(dataOf(await resolve(SUM_LINK).expect(200))).toMatchObject({
        latestPackage: { id: 30, state: 'READY', type: 'standard' },
      });
      polygon.reply('problem.packages', {
        result: [pkg(30, 3, 'READY'), pkg(31, 3, 'FAILED', 'standard')],
      });
      expect(refusalOf(await resolve(SUM_LINK).expect(409))).toMatchObject({
        code: 'polygon_package_not_ready',
        message:
          'Polygon problem 1 has no READY package: its newest package 31 (revision 3) is FAILED. Build a package on Polygon first',
      });
    });

    it('names the QHHOJ problem it is already linked to only to a user who may edit that problem', async () => {
      sharedProblems();
      await createProblem(api, catalog, {
        code: 'taken_link',
        authors: [importerId],
        polygonLink: linkOf(1) as never,
      });
      expect(refusalOf(await resolve(SUM_LINK).expect(409))).toMatchObject({
        code: 'polygon_already_linked',
        message: 'Polygon problem 1 is already linked to taken_link',
        linkedProblemCode: 'taken_link',
      });
      const outsider = await loginAs(
        api,
        (
          await createUserWith(api, 'outsider', {
            permissions: ['judge.add_problem', 'judge.edit_own_problem'],
          })
        )._id,
      );
      const hidden = await resolve(SUM_LINK, outsider).expect(409);
      expect(refusalOf(hidden)).toMatchObject({
        code: 'polygon_already_linked',
        message: 'Polygon problem 1 is already linked to a QHHOJ problem',
      });
      expect(JSON.stringify(hidden.body)).not.toContain('taken_link');
    });

    it('limits link checks per user', async () => {
      sharedProblems();
      for (let check = 0; check < POLYGON_LINK_LIMIT; check += 1)
        await resolve(SUM_LINK).expect(200);
      await resolve(SUM_LINK).expect(429).expect(errorCode('rate_limited'));
      await post(`${POLYGON}/import`, { link: SUM_LINK, code: 'limited' })
        .expect(429)
        .expect(errorCode('rate_limited'));
      expect(await queue.count()).toBe(0);
    });
  });

  it('answers not connected without calling Polygon while the secret is unset', async () => {
    await api.setSetting('polygon.apiSecret', '');
    try {
      expect(dataOf(await get(`${POLYGON}/status`).expect(200))).toMatchObject({
        connected: false,
      });
      await post(`${POLYGON}/resolve`, { link: SUM_LINK })
        .expect(409)
        .expect(errorCode('polygon_not_connected'));
      expect(polygon.calls).toEqual([]);
    } finally {
      await api.setSetting('polygon.apiSecret', 'SECRET');
    }
  });

  it('queues a private import of the newest full package, owned by the importer, with the zip import options and the link', async () => {
    sharedProblems();
    const response = await post(`${POLYGON}/import`, {
      link: SUM_LINK,
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
      curators: [importerId],
      points: 900,
      groupId: catalog.groups.voi,
      statementLanguages: { vietnamese: 'vi' },
      polygon: {
        problemId: 1,
        name: 'sum',
        owner: 'alice',
        revision: 3,
        packageId: 10,
        packageType: 'full',
        packageCreatedAt: BUILT_AT,
        purpose: 'link',
        autoSync: true,
        trigger: 'manual',
      },
    });
    expect(JSON.stringify(job?.data)).not.toContain(TOKENS['1']);
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

  it('checks the link again on import and queues nothing for a wrong token', async () => {
    sharedProblems();
    await post(`${POLYGON}/import`, {
      link: linkTo('alice', 'sum', 'pWrong1'),
      code: 'guessed',
    })
      .expect(404)
      .expect(errorCode('polygon_link_refused'));
    expect(await queue.count()).toBe(0);
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
        await post(`${POLYGON}/import`, {
          link: SUM_LINK,
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
          permissions: ['judge.edit_all_problem'],
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
        polygon: {
          packageId: 11,
          packageType: 'full',
          revision: 4,
          purpose: 'sync',
        },
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
        latestPackage: { id: 11, revision: 4, state: 'READY', type: 'full' },
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
      ).toEqual([
        ['polygonLink.autoSync', 'polygonLink.linkedBy'],
        ['polygonLink'],
      ]);
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

    it('shows the link and its history to an editor without judge.sync_polygon_problem, who may not sync or change it', async () => {
      const editorId = (
        await createUserWith(api, `editor_${counter}`, {
          permissions: ['judge.edit_own_problem'],
        })
      )._id;
      const editor = await loginAs(api, editorId);
      await api.problems.updateOne(
        { code },
        { $set: { curators: [editorId] } },
      );
      polygon.reply('problem.packages', { result: [pkg(11, 4, 'READY')] });
      await get(links(), editor).expect(200);
      await get(`${links()}/syncs`, editor).expect(200);
      await post(`${links()}/sync`, {}, editor)
        .expect(403)
        .expect(errorCode('forbidden'));
      await authed(api.http().patch(links()), editor)
        .send({ autoSync: true })
        .expect(403);
      await authed(api.http().delete(links()), editor).expect(403);
      expect((await queue.getJobCounts('waiting')).waiting).toBe(0);
      expect(
        (await api.problems.findOne({ code }))!.polygonLink,
      ).not.toBeNull();
    });

    it('runs auto-sync as the user who switched it on', async () => {
      await authed(api.http().patch(links()), importer)
        .send({ autoSync: true })
        .expect(200);
      const { polygonLink } = (await api.problems.findOne({ code }))!;
      expect(uuidStr(polygonLink!.linkedBy)).toBe(importerId);
    });
  });

  describe('an organization problem creator without the import permission', () => {
    let teacher: TestSession;
    let teacherId: string, organizationId: string;

    beforeAll(async () => {
      teacherId = (
        await createUserWith(api, 'polyteacher', {
          permissions: [
            'judge.create_organization_problem',
            'judge.edit_own_problem',
          ],
        })
      )._id;
      teacher = await loginAs(api, teacherId);
      organizationId = uuidStr(
        (
          await createOrganization(api, {
            slug: 'thpt-poly',
            adminIds: [teacherId],
          })
        )._id,
      );
    });

    it('checks a link and imports it into the organization only', async () => {
      sharedProblems();
      await get(`${POLYGON}/status`, teacher).expect(200);
      await post(`${POLYGON}/resolve`, { link: SUM_LINK }, teacher).expect(200);
      await post(
        `${POLYGON}/import`,
        { link: SUM_LINK, code: 'site_sum' },
        teacher,
      )
        .expect(403)
        .expect(errorCode('forbidden'));
      const response = await post(
        `${POLYGON}/import`,
        { link: SUM_LINK, code: 'thptpoly_sum', organization: 'thpt-poly' },
        teacher,
      ).expect(202);
      const job = await queue.getJob(dataOf<{ jobId: string }>(response).jobId);
      expect(job?.data).toMatchObject({
        code: 'thptpoly_sum',
        mode: 'create',
        organizationId,
      });
    });

    it('may not turn on auto-sync without judge.sync_polygon_problem', async () => {
      sharedProblems();
      await post(
        `${POLYGON}/import`,
        {
          link: SUM_LINK,
          code: 'thptpoly_auto',
          organization: 'thpt-poly',
          autoSync: true,
        },
        teacher,
      )
        .expect(403)
        .expect(errorCode('forbidden'));
      await get(`${POLYGON}/syncs`, teacher).expect(403);
    });

    it('reads the link of its organization problem but may not sync it', async () => {
      await createProblem(api, catalog, {
        code: 'thptpoly_linked',
        curators: [teacherId],
        isOrganizationPrivate: true,
        organizations: [organizationId],
        polygonLink: linkOf(900) as never,
      });
      const links = '/api/internal/problems/thptpoly_linked/polygon';
      polygon.reply('problem.packages', { result: [pkg(11, 4, 'READY')] });
      await get(links, teacher).expect(200);
      await get(`${links}/syncs`, teacher).expect(200);
      await post(`${links}/sync`, {}, teacher)
        .expect(403)
        .expect(errorCode('forbidden'));
      sharedProblems();
      await post(
        `${POLYGON}/import`,
        { link: SUM_LINK, code: 'thptpoly_linked', mode: 'update' },
        teacher,
      )
        .expect(403)
        .expect(errorCode('forbidden'));
    });
  });
});
