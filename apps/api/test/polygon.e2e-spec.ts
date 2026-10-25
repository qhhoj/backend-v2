import { getQueueToken } from '@nestjs/bullmq';
import { getModelToken } from '@nestjs/mongoose';
import { UnrecoverableError, Worker } from 'bullmq';
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
  syncJobId,
} from '@libs/problems';
import type { PolygonImportJob } from '@libs/problems';
import { buildZip, FakePolygon } from '@libs/problems/testing';
import { POLYGON_LINK_LIMIT } from '../src/modules/problems/core/rate-limits';
import { softDelete, tombstone } from './deleted-problem-fixtures';
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
/** `alice/sum` has an English and a Vietnamese statement: an import names the main one and maps the other. */
const SUM_LANGUAGES = {
  mainStatementLanguage: 'vietnamese',
  statementLanguages: ['english=en'],
};
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
            ? {
                english: { name: 'Sum' },
                vietnamese: { name: 'Tổng', tutorial: 'Cộng lại.' },
              }
            : {},
      }));
  const get = (path: string, session = importer) =>
    authed(api.http().get(path), session);
  const post = (path: string, body: object = {}, session = importer) =>
    authed(api.http().post(path), session).send(body);
  const refusalOf = ({ body }: { body: unknown }) =>
    (body as { error: Record<string, unknown> }).error;

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
    const resolve = (link: string, session = importer, code?: string) =>
      post(`${POLYGON}/resolve`, { link, code }, session);
    it('previews the problem when the token matches its newest package, reading the package once', async () => {
      sharedProblems();
      const preview = dataOf(await resolve(SUM_LINK).expect(200));
      expect(preview).toEqual({
        id: 1,
        name: 'sum',
        owner: 'alice',
        title: 'Tổng',
        statements: [
          { language: 'english', title: 'Sum', hasTutorial: false },
          { language: 'vietnamese', title: 'Tổng', hasTutorial: true },
        ],
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

    it('says the package cannot be downloaded, not that Polygon is unreachable, when Polygon answers the download with an HTTP error', async () => {
      sharedProblems().reply('problem.package', { status: 500 });
      await resolve(SUM_LINK)
        .expect(502)
        .expect(errorCode('polygon_package_unavailable'));
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

    it('names a first build that is running or failed, without Polygon comment before the token is checked, instead of asking for a package', async () => {
      sharedProblems();
      polygon.reply('problem.packages', {
        result: [
          {
            ...pkg(30, 3, 'FAILED', 'standard'),
            comment: 'Solution tle.cpp passed all tests',
          },
        ],
      });
      expect(refusalOf(await resolve(SUM_LINK).expect(409))).toMatchObject({
        code: 'polygon_package_not_ready',
        newestPackage: {
          id: 30,
          revision: 3,
          state: 'FAILED',
          comment: null,
        },
      });
      polygon.reply('problem.packages', {
        result: [pkg(31, 4, 'PENDING', 'standard')],
      });
      expect(refusalOf(await resolve(SUM_LINK).expect(409))).toMatchObject({
        code: 'polygon_package_not_ready',
        newestPackage: { id: 31, state: 'RUNNING', comment: null },
      });
      expect(polygon.callsOf('problem.package')).toHaveLength(0);
    });

    it('downloads a package for its first check once at a time, answering a parallel check to come back', async () => {
      sharedProblems();
      await redis.set('polygon:link-token-check:1', '1', 'EX', 60);
      try {
        await resolve(SUM_LINK)
          .expect(409)
          .expect('Retry-After', '60')
          .expect(errorCode('polygon_link_checking'));
        expect(polygon.callsOf('problem.package')).toHaveLength(0);
      } finally {
        await redis.del('polygon:link-token-check:1');
      }
      await resolve(SUM_LINK).expect(200);
      expect(await redis.exists('polygon:link-token-check:1')).toBe(0);
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

    it('lets the linked problem check its own link again, but not another problem', async () => {
      sharedProblems();
      await createProblem(api, catalog, {
        code: 'holder',
        authors: [importerId],
        polygonLink: linkOf(1) as never,
      });
      await resolve(SUM_LINK, importer, 'holder').expect(200);
      await resolve(SUM_LINK, importer, 'other')
        .expect(409)
        .expect(errorCode('polygon_already_linked'));
    });

    it('answers a link held by a problem in its grace period with polygon_linked_deleted, and frees it once purged', async () => {
      sharedProblems();
      const holder = await createProblem(api, catalog, {
        code: 'gone_holder',
        authors: [importerId],
        polygonLink: linkOf(1) as never,
      });
      await softDelete(api, holder._id);
      expect(refusalOf(await resolve(SUM_LINK).expect(409))).toMatchObject({
        code: 'polygon_linked_deleted',
        linkedProblemCode: 'gone_holder',
      });
      await post(`${POLYGON}/import`, { link: SUM_LINK, code: 'again' })
        .expect(409)
        .expect(errorCode('polygon_linked_deleted'));
      await tombstone(api, holder._id);
      await resolve(SUM_LINK).expect(200);
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
    // A waiting job's progress is stale (a stalled job put back): only a running job shows it.
    expect(
      dataOf(
        await get(`/api/internal/problems/imports/${job!.id}`).expect(200),
      ),
    ).toMatchObject({ step: 'queued', progress: null });
    let release = () => undefined as void;
    const worker = new Worker<PolygonImportJob>(
      POLYGON_QUEUE,
      () => new Promise<void>((resolve) => (release = resolve)),
      { connection: queue.opts.connection },
    );
    try {
      await waitUntil(async () => (await job!.getState()) === 'active', 15_000);
      expect(
        dataOf(
          await get(`/api/internal/problems/imports/${job!.id}`).expect(200),
        ),
      ).toMatchObject({
        step: 'downloading',
        progress: { step: 'downloading', done: 5, total: 10 },
      });
    } finally {
      release();
      await worker.close();
    }
  });

  it('queues no authors, curators or types of an update that sends empty lists', async () => {
    await createProblem(api, catalog, {
      code: 'empty_lists',
      authors: [importerId],
      curators: [importerId],
    });
    sharedProblems();
    const response = await post(`${POLYGON}/import`, {
      link: SUM_LINK,
      code: 'empty_lists',
      mode: 'update',
      ...SUM_LANGUAGES,
      authors: [],
      curators: [],
      typeIds: [],
    }).expect(202);
    const job = await queue.getJob(dataOf<{ jobId: string }>(response).jobId);
    expect(job?.data).toMatchObject({ mode: 'update', code: 'empty_lists' });
    for (const field of ['authors', 'curators', 'typeIds'])
      expect(job?.data[field as keyof typeof job.data]).toBeUndefined();
  });

  it('queues the main-solution switch as sent, off when omitted', async () => {
    const queued = async (code: string, extra: object) => {
      sharedProblems();
      const response = await post(`${POLYGON}/import`, {
        link: SUM_LINK,
        code,
        ...SUM_LANGUAGES,
        ...extra,
      }).expect(202);
      const { jobId } = dataOf<{ jobId: string }>(response);
      return (await queue.getJob(jobId))?.data.appendMainSolution;
    };
    expect(await queued('sol_off', { appendMainSolution: false })).toBe(false);
    expect(await queued('sol_omitted', {})).toBe(false);
    expect(await queued('sol_on', { appendMainSolution: true })).toBe(true);
    // Give the three imports back: the importer's hourly budget is shared by the later tests.
    await redis.del(`rate:import:user:${importerId}`);
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

  it('answers where a failed import stopped, with the error written for the requester and its code', async () => {
    const worker = new Worker<PolygonImportJob>(
      POLYGON_QUEUE,
      async (job) => {
        await job.updateData({
          ...job.data,
          failedStep: 'statements',
          errorCode: 'tutorial_language_required',
          errorParams: { languages: ['english', 'vietnamese'] },
        });
        throw new UnrecoverableError(
          `${POLYGON_ERROR_PREFIX}invalid main tutorial language (none)`,
        );
      },
      { connection: queue.opts.connection },
    );
    try {
      sharedProblems();
      const { jobId } = dataOf<{ jobId: string }>(
        await post(`${POLYGON}/import`, {
          link: SUM_LINK,
          code: 'fails_polygon',
          ...SUM_LANGUAGES,
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
        code: 'fails_polygon',
        mode: 'create',
        purpose: 'link',
        state: 'failed',
        step: 'failed',
        queuePosition: null,
        failedStep: 'statements',
        error: 'invalid main tutorial language (none)',
        errorCode: 'tutorial_language_required',
        errorParams: { languages: ['english', 'vietnamese'] },
        retryable: false,
        finishedAt: expect.any(String) as unknown,
      });
    } finally {
      await worker.close();
    }
  });

  it('refuses at queue time the language options and the test count the worker would refuse', async () => {
    sharedProblems();
    expect(
      (
        await post(`${POLYGON}/import`, {
          link: SUM_LINK,
          code: 'no_main',
        }).expect(400)
      ).body,
    ).toMatchObject({
      error: {
        code: 'statement_language_required',
        params: { languages: ['english', 'vietnamese'] },
      },
    });
    polygon.reply('problem.tests', {
      result: Array.from({ length: 301 }, (_unused, index) => ({ index })),
    });
    expect(
      (
        await post(`${POLYGON}/import`, {
          link: SUM_LINK,
          code: 'many_tests',
          ...SUM_LANGUAGES,
        }).expect(400)
      ).body,
    ).toMatchObject({
      error: {
        code: 'too_many_testcases',
        params: { count: 301, limit: 300 },
      },
    });
    expect(polygon.callsOf('problem.tests')[0].params).toMatchObject({
      testset: 'tests',
      noInputs: 'true',
    });
    expect(await queue.count()).toBe(0);
  });

  it('places waiting jobs in the order the worker takes them, automatic syncs last, and lists my jobs of the day', async () => {
    const data = (code: string): PolygonImportJob =>
      ({ requesterId: importerId, code, mode: 'create' }) as PolygonImportJob;
    const first = newId();
    const auto = newId();
    const second = newId();
    await queue.add('import', data('first'), { jobId: first });
    await queue.add('sync', data('auto'), { jobId: auto, priority: 10 });
    await queue.add('import', data('second'), { jobId: second });
    const placeOf = async (jobId: string) =>
      dataOf<{ queuePosition: number | null }>(
        await get(`/api/internal/problems/imports/${jobId}`).expect(200),
      ).queuePosition;
    expect([
      await placeOf(first),
      await placeOf(second),
      await placeOf(auto),
    ]).toEqual([1, 2, 3]);
    const mine = dataOf<Array<{ id: string; step: string }>>(
      await get('/api/internal/problems/imports?mine=1').expect(200),
    );
    expect(
      mine
        .map(({ id }) => id)
        .filter((id) => [first, auto, second].includes(id)),
    ).toEqual([second, auto, first]);
    expect(
      dataOf(
        await get('/api/internal/problems/imports?mine=1', plain).expect(200),
      ),
    ).toEqual([]);
    await get('/api/internal/problems/imports').expect(400);
  });

  it('shows the conversion summary of a finished import and an import that needs a repair', async () => {
    const summary = {
      polygonChecker: 'std::wcmp.cpp',
      checker: 'bridged',
      interactive: false,
      checkerIgnored: false,
      tests: 3,
      cases: 3,
      batches: 0,
      timeLimit: { polygon: 90, applied: 60 },
      memoryLimit: { polygon: 262144, applied: 262144 },
    };
    const attention = {
      code: 'imported_needs_attention',
      params: { step: 'writing init.yml' },
      message: 'the problem was imported, but writing init.yml failed',
    };
    const localEdits = { kept: ['timeLimit'], updated: ['checker'] };
    const worker = new Worker<PolygonImportJob>(
      POLYGON_QUEUE,
      (job) =>
        Promise.resolve({
          problemId: 'p',
          code: job.data.code,
          summary,
          localEdits,
          attention,
        }),
      { connection: queue.opts.connection },
    );
    const jobId = newId();
    try {
      await queue.add(
        'import',
        { requesterId: importerId, code: 'repair', mode: 'create' } as never,
        { jobId },
      );
      await waitUntil(
        async () => (await queue.getJob(jobId))?.finishedOn !== undefined,
        15_000,
      );
    } finally {
      await worker.close();
    }
    expect(
      dataOf(await get(`/api/internal/problems/imports/${jobId}`).expect(200)),
    ).toMatchObject({
      state: 'completed',
      step: 'done',
      error: null,
      errorCode: null,
      result: { code: 'repair', summary, localEdits, attention },
    });
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

    it('joins a sync of the same package that is still queued, shows it to the problem editors, and replaces it once finished', async () => {
      await api.problems.updateOne(
        { code },
        { $set: { 'polygonLink.options.maxCases': 9999 } },
      );
      polygon.reply('problem.packages', { result: [pkg(11, 4, 'READY')] });
      const { jobId } = dataOf<{ jobId: string }>(
        await post(`${links()}/sync`).expect(202),
      );
      expect(
        dataOf<{ jobId: string }>(await post(`${links()}/sync`).expect(202))
          .jobId,
      ).toBe(jobId);
      expect(await queue.count()).toBe(1);
      expect((await queue.getJob(jobId))?.data.maxCases).toBe(9999);
      expect(dataOf(await get(links()).expect(200))).toMatchObject({
        runningJobId: jobId,
      });
      const editorId = (
        await createUserWith(api, `follower_${counter}`, {
          permissions: ['judge.edit_own_problem'],
        })
      )._id;
      await api.problems.updateOne(
        { code },
        { $set: { curators: [editorId] } },
      );
      expect(
        dataOf(
          await get(
            `/api/internal/problems/imports/${jobId}`,
            await loginAs(api, editorId),
          ).expect(200),
        ),
      ).toMatchObject({ id: jobId, state: 'waiting', step: 'queued' });
      await get(`/api/internal/problems/imports/${jobId}`, plain).expect(404);

      const worker = new Worker<PolygonImportJob>(
        POLYGON_QUEUE,
        (job) => Promise.resolve({ problemId: 'done', code: job.data.code }),
        { connection: queue.opts.connection },
      );
      try {
        await waitUntil(
          async () => (await queue.getJob(jobId))?.finishedOn !== undefined,
          15_000,
        );
      } finally {
        await worker.close();
      }
      expect(dataOf(await get(links()).expect(200))).toMatchObject({
        runningJobId: null,
      });
      await post(`${links()}/sync`).expect(202);
      expect(await (await queue.getJob(jobId))?.getState()).toBe('waiting');
    });

    it('replaces an automatic sync the worker holds back for a contest with the manual one, which runs now', async () => {
      polygon.reply('problem.packages', { result: [pkg(11, 4, 'READY')] });
      const problem = (await api.problems.findOne({ code }))!;
      const jobId = syncJobId(uuidStr(problem._id), 11);
      await queue.add(
        'sync',
        {
          code,
          requesterId: importerId,
          mode: 'update',
          polygon: { packageId: 11, purpose: 'sync', trigger: 'auto' },
        } as PolygonImportJob,
        { jobId, delay: 3_600_000 },
      );
      const { jobId: started } = dataOf<{ jobId: string }>(
        await post(`${links()}/sync`).expect(202),
      );
      expect(started).toBe(jobId);
      const job = (await queue.getJob(jobId))!;
      expect(await job.getState()).toBe('waiting');
      expect(job.data.polygon?.trigger).toBe('manual');
    });

    it('refuses a sync while the newest package is still building or failed, with Polygon comment on a linked problem', async () => {
      polygon.reply('problem.packages', {
        result: [pkg(10, 3, 'READY'), pkg(11, 4, 'RUNNING')],
      });
      await post(`${links()}/sync`)
        .expect(409)
        .expect(errorCode('polygon_package_not_ready'));
      polygon.reply('problem.packages', {
        result: [
          pkg(10, 3, 'READY'),
          { ...pkg(11, 4, 'FAILED'), comment: 'Solution tle.cpp passed' },
        ],
      });
      expect(
        refusalOf(await post(`${links()}/sync`).expect(409)),
      ).toMatchObject({
        newestPackage: { id: 11, comment: 'Solution tle.cpp passed' },
      });
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

    it('edits the saved options, which the next sync uses, writing a revision of the changed fields only', async () => {
      const patch = (body: object) =>
        authed(api.http().patch(links()), importer).send(body);
      polygon.reply('problem.statements', {
        result: {
          english: { name: 'Sum' },
          russian: { name: 'Сумма' },
          vietnamese: { name: 'Tổng' },
        },
      });
      expect(
        dataOf(
          await patch({
            statementLanguages: ['vietnamese=vi', 'russian=skip'],
            appendMainSolution: false,
            importTutorial: false,
            ignoreZeroPointCases: true,
            mainStatementLanguage: 'english',
          }).expect(200),
        ),
      ).toMatchObject({
        autoSync: false,
        options: {
          mainStatementLanguage: 'english',
          statementLanguages: ['russian=skip', 'vietnamese=vi'],
          appendMainSolution: false,
          importTutorial: false,
          ignoreZeroPointCases: true,
          ignoreZeroPointBatches: false,
          maxCases: 300,
        },
      });
      await patch({ appendMainSolution: false }).expect(200);
      const problem = await api.problems.findOne({ code });
      const revisions = await api.revisions.find({
        entityId: problem!._id,
        action: 'polygon_link',
      });
      expect(revisions.map((revision) => revision.changes)).toEqual([
        {
          'polygonLink.options.statementLanguages': {
            before: { vietnamese: 'vi' },
            after: { vietnamese: 'vi', russian: 'skip' },
          },
          'polygonLink.options.ignoreZeroPointCases': {
            before: false,
            after: true,
          },
          'polygonLink.options.appendMainSolution': {
            before: true,
            after: false,
          },
          'polygonLink.options.importTutorial': {
            before: true,
            after: false,
          },
        },
      ]);

      polygon.reply('problem.packages', { result: [pkg(11, 4, 'READY')] });
      const { jobId } = dataOf<{ jobId: string }>(
        await post(`${links()}/sync`).expect(202),
      );
      expect((await queue.getJob(jobId))?.data).toMatchObject({
        statementLanguages: { vietnamese: 'vi', russian: 'skip' },
        ignoreZeroPointCases: true,
        appendMainSolution: false,
        importTutorial: false,
        maxCases: 300,
      });
    });

    it('refuses options the package would fail with the sync code, and malformed ones, keeping the saved options', async () => {
      const patch = (body: object) =>
        authed(api.http().patch(links()), importer).send(body);
      polygon.reply('problem.statements', {
        result: {
          english: { name: 'Sum' },
          russian: { name: 'Сумма' },
          vietnamese: { name: 'Tổng' },
        },
      });
      expect(
        (await patch({ statementLanguages: ['vietnamese=en'] }).expect(400))
          .body,
      ).toMatchObject({
        error: {
          code: 'statement_language_unmapped',
          params: { language: 'russian' },
        },
      });
      await patch({ statementLanguages: ['vietnamese=fr'] }).expect(400);
      await patch({ maxCases: 9999 }).expect(400);
      const { polygonLink } = (await api.problems.findOne({ code }))!;
      expect(polygonLink!.options).toMatchObject({
        statementLanguages: { vietnamese: 'vi' },
        maxCases: 300,
      });
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

    it('shows the last sync failure with its code and parameters, and refuses a sync the link options would fail', async () => {
      await api.problems.updateOne(
        { code },
        {
          $set: {
            'polygonLink.lastSyncResult': 'failed',
            'polygonLink.lastSyncError': 'invalid site language for russian',
            'polygonLink.lastSyncErrorCode': 'statement_language_unmapped',
            'polygonLink.lastSyncErrorParams': { language: 'russian' },
          },
        },
      );
      polygon
        .reply('problem.packages', { result: [pkg(11, 4, 'READY')] })
        .reply('problem.statements', {
          result: {
            english: { name: 'Sum' },
            russian: { name: 'Сумма' },
            vietnamese: { name: 'Tổng' },
          },
        });
      expect(dataOf(await get(links()).expect(200))).toMatchObject({
        link: {
          lastSyncResult: 'failed',
          lastSyncErrorCode: 'statement_language_unmapped',
          lastSyncErrorParams: { language: 'russian' },
        },
      });
      expect((await post(`${links()}/sync`).expect(400)).body).toMatchObject({
        error: {
          code: 'statement_language_unmapped',
          params: { language: 'russian' },
        },
      });
      expect(await queue.count()).toBe(0);
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
      await authed(api.http().patch(links()), editor)
        .send({ ignoreZeroPointCases: true })
        .expect(403);
      await authed(api.http().delete(links()), editor).expect(403);
      expect((await queue.getJobCounts('waiting')).waiting).toBe(0);
      const { polygonLink } = (await api.problems.findOne({ code }))!;
      expect(polygonLink?.options.ignoreZeroPointCases).toBe(false);
    });

    it('refuses option changes from a holder of the sync permission who may not edit the problem', async () => {
      const outsider = await loginAs(
        api,
        (
          await createUserWith(api, `outsider_${counter}`, {
            permissions: [
              'judge.sync_polygon_problem',
              'judge.edit_own_problem',
            ],
          })
        )._id,
      );
      const response = await authed(api.http().patch(links()), outsider).send({
        ignoreZeroPointCases: true,
      });
      expect([403, 404]).toContain(response.status);
      const { polygonLink } = (await api.problems.findOne({ code }))!;
      expect(polygonLink?.options.ignoreZeroPointCases).toBe(false);
    });

    it('queues a sync that overwrites the local edits only on request, and never joins one that keeps them', async () => {
      polygon.reply('problem.packages', { result: [pkg(11, 4, 'READY')] });
      const { jobId } = dataOf<{ jobId: string }>(
        await authed(api.http().post(`${links()}/sync`), importer).expect(202),
      );
      expect((await queue.getJob(jobId))?.data).not.toHaveProperty(
        'overwriteLocalEdits',
      );
      await post(`${links()}/sync`, { overwriteLocalEdits: true })
        .expect(409)
        .expect(errorCode('polygon_sync_queued'));
      await queue.drain(true);
      const overwriting = dataOf<{ jobId: string }>(
        await post(`${links()}/sync`, { overwriteLocalEdits: true }).expect(
          202,
        ),
      ).jobId;
      expect((await queue.getJob(overwriting))?.data).toMatchObject({
        overwriteLocalEdits: true,
      });
      expect(
        dataOf<{ jobId: string }>(await post(`${links()}/sync`).expect(202))
          .jobId,
      ).toBe(overwriting);
      await post(`${links()}/sync`, { overwriteLocalEdits: 'yes' }).expect(400);
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
        {
          link: SUM_LINK,
          code: 'thptpoly_sum',
          organization: 'thpt-poly',
          ...SUM_LANGUAGES,
        },
        teacher,
      ).expect(202);
      const job = await queue.getJob(dataOf<{ jobId: string }>(response).jobId);
      expect(job?.data).toMatchObject({
        code: 'thptpoly_sum',
        mode: 'create',
        organizationId,
      });
    });

    it('imports into the organization with the administrator as author', async () => {
      sharedProblems();
      const response = await post(
        `${POLYGON}/import`,
        {
          link: SUM_LINK,
          code: 'thptpoly_authored',
          organization: 'thpt-poly',
          ...SUM_LANGUAGES,
          points: 800,
          typeIds: [catalog.types.uncategorized],
          authors: [teacherId],
        },
        teacher,
      ).expect(202);
      const job = await queue.getJob(dataOf<{ jobId: string }>(response).jobId);
      expect(job?.data).toMatchObject({
        code: 'thptpoly_authored',
        organizationId,
        authors: [teacherId],
        curators: [teacherId],
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
