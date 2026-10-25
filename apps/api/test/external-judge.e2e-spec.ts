import { getModelToken } from '@nestjs/mongoose';
import type Redis from 'ioredis';
import type { Model } from 'mongoose';
import { REDIS } from '@libs/common';
import { ExternalRun, uuidStr } from '@libs/database';
import type { User } from '@libs/database';
import { EXTERNAL_JUDGE_FETCH } from '@libs/judging';
import { ExternalJudgeStatusService } from '../src/modules/problems/external-judge/external-judge-status.service';
import { EXTERNAL_JUDGE_LOOKUP_LIMIT } from '../src/modules/problems/core/rate-limits';
import {
  authed,
  createProblem,
  createUserWith,
  loginAs,
  seedCatalog,
} from './problem-fixtures';
import type { Catalog, TestSession } from './problem-fixtures';
import { dataOf, seedSubmission } from './submission-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';

const TOKEN = 'tok-8f31c0de-MARKER';
const BASE_URL = 'https://pcd-vjudge.example.test';
const BASE_HOST = 'pcd-vjudge.example.test';
const ADMIN_TEST = '/api/internal/external-judge/test';
const STATUS = '/api/internal/external-judge/status';
const configOf = (code: string) =>
  `/api/internal/problems/${code}/external-judge`;

type Mode = 'ok' | 'unauthorized' | 'network';
/** A fake PCD VJudge; error answers carry the marker like a careless upstream would. */
class FakeExternalJudge {
  mode: Mode = 'ok';
  paths: string[] = [];

  fetch = (input: URL | RequestInfo): Promise<Response> => {
    const path = new URL(input as URL).pathname;
    this.paths.push(path);
    if (this.mode === 'network')
      return Promise.reject(new TypeError(`connect ECONNREFUSED ${BASE_HOST}`));
    if (this.mode === 'unauthorized')
      return Promise.resolve(
        new Response(`{"error":"bad token ${TOKEN}"}`, { status: 401 }),
      );
    return Promise.resolve(Response.json(this.answer(path)));
  };

  private answer(path: string): unknown {
    if (path === '/api/v1/ojs')
      return {
        items: [
          {
            oj: 'CodeForces',
            languages: [{ id: '54', name: 'GNU G++17 7.3.0' }],
          },
          { oj: 'QOJ', languages: [] },
        ],
      };
    if (path === '/api/v1/problems')
      return {
        items: [
          {
            oj: 'CodeForces',
            problemId: '4A',
            title: 'Watermelon',
            source: '',
          },
        ],
        total: 1,
        page: 1,
      };
    return {
      title: 'Watermelon',
      languages: [
        { id: '54', name: 'GNU G++17 7.3.0' },
        { id: '31', name: 'Python 3.8' },
      ],
    };
  }
}

describe('External judge routes', () => {
  const remote = new FakeExternalJudge();
  let api: ApiTest;
  let catalog: Catalog;
  let redis: Redis;
  let runs: Model<ExternalRun>;
  let admin: TestSession, editor: TestSession, plain: TestSession;
  let rejudger: TestSession;
  let editorId: string;
  const as = (session: TestSession) => ({
    get: (path: string) => authed(api.http().get(path), session),
    post: (path: string, body: object = {}) =>
      authed(api.http().post(path), session).send(body),
    put: (path: string, body: object) =>
      authed(api.http().put(path), session).send(body),
    delete: (path: string) => authed(api.http().delete(path), session),
  });
  const mapping = () => ({
    isActive: true,
    oj: 'CodeForces',
    problemId: '4A',
    title: 'Watermelon',
    languages: [{ languageId: catalog.languages.cpp, remoteId: '54' }],
  });
  const allowedOf = async (code: string) =>
    (await api.problems.findOne({ code }))!.allowedLanguages.map(uuidStr);

  beforeAll(async () => {
    api = await setupApiTest({
      overrides: [{ provide: EXTERNAL_JUDGE_FETCH, useValue: remote.fetch }],
    });
    catalog = await seedCatalog(api);
    redis = api.app.get(REDIS);
    runs = api.app.get(getModelToken(ExternalRun.name));
    await api.languages.updateOne(
      { _id: catalog.languages.text },
      { fileOnly: true },
    );
    await api.resyncCatalog();
    const session = async (name: string, extra: Partial<User> = {}) => {
      const user = await createUserWith(api, name, extra);
      return { user, session: await loginAs(api, user._id) };
    };
    // The external judge settings are superuser-only (decision 416).
    admin = (await session('admin', { isSuperuser: true })).session;
    const editorLogin = await session('editor', {
      permissions: ['judge.edit_own_problem'],
    });
    editor = editorLogin.session;
    editorId = editorLogin.user._id;
    plain = (await session('plain')).session;
    const rejudgerLogin = await session('rejudger', {
      permissions: ['judge.edit_own_problem', 'judge.rejudge_submission'],
    });
    rejudger = rejudgerLogin.session;
    await createProblem(api, catalog, {
      code: 'melon',
      authors: [editorId, rejudgerLogin.user._id],
    });
    await api.setSetting('externalJudge.baseUrl', BASE_URL);
    await api.setSetting('externalJudge.apiToken', TOKEN);
  });
  beforeEach(() => {
    remote.mode = 'ok';
    remote.paths = [];
  });
  afterAll(() => api.teardown());

  it('refuses the admin test without the settings permission and the problem routes to non-editors', async () => {
    await as(editor).post(ADMIN_TEST).expect(403);
    await as(plain).get(configOf('melon')).expect(403);
    await as(plain).put(configOf('melon'), mapping()).expect(403);
    await as(plain).delete(configOf('melon')).expect(403);
    await as(plain)
      .post(`${configOf('melon')}/search`, { oj: 'QOJ' })
      .expect(403);
    await as(plain)
      .post(`${configOf('melon')}/verify`, { oj: 'QOJ', problemId: '1' })
      .expect(403);
    expect(remote.paths).toEqual([]);
  });

  it('tests the connection and maps the external judge failures to HTTP answers', async () => {
    expect(dataOf(await as(admin).post(ADMIN_TEST).expect(200))).toEqual({
      ok: true,
      ojs: ['CodeForces', 'QOJ'],
    });
    remote.mode = 'unauthorized';
    await as(admin)
      .post(ADMIN_TEST)
      .expect(502)
      .expect(errorCode('external_judge_unauthorized'));
    remote.mode = 'network';
    await as(admin)
      .post(ADMIN_TEST)
      .expect(503)
      .expect(errorCode('external_judge_unavailable'));
  });

  it('answers 409 while the external judge is not configured', async () => {
    await api.setSetting('externalJudge.apiToken', '');
    try {
      await as(admin)
        .post(ADMIN_TEST)
        .expect(409)
        .expect(errorCode('external_judge_not_configured'));
      expect(
        dataOf(await as(editor).get(configOf('melon')).expect(200)),
      ).toEqual({ connected: false, link: null });
      expect(dataOf(await api.http().get(STATUS).expect(200))).toEqual({
        enabled: false,
        reachable: null,
        checkedAt: null,
        ojs: [],
      });
    } finally {
      await api.setSetting('externalJudge.apiToken', TOKEN);
    }
  });

  it('never puts the token or the base URL in any response, whether the remote answers, refuses the token or is down', async () => {
    const status = api.app.get(ExternalJudgeStatusService);
    for (const mode of ['ok', 'unauthorized', 'network'] as const) {
      remote.mode = mode;
      const link = configOf('melon');
      const responses = [
        await as(admin).post(ADMIN_TEST),
        await as(editor).get(link),
        await as(editor).put(link, mapping()),
        await as(editor).post(`${link}/search`, { oj: 'CodeForces' }),
        await as(editor).post(`${link}/verify`, {
          oj: 'CodeForces',
          problemId: '4A',
        }),
        await as(admin).get('/api/internal/admin/settings'),
        await as(admin).get(
          '/api/internal/admin/settings/externalJudge.apiToken/revisions',
        ),
        await api.http().get(STATUS),
      ];
      // Another check must reach the fake again.
      Object.assign(status, { cached: null });
      for (const response of responses) {
        const wire = JSON.stringify({
          body: response.body as unknown,
          headers: response.headers as unknown,
        });
        expect(wire).not.toContain('MARKER');
      }
      // The settings API shows the base URL to settings staff on purpose; nothing else does.
      for (const response of [...responses.slice(0, 5), responses[7]]) {
        expect(JSON.stringify(response.body)).not.toContain(BASE_HOST);
      }
      expect(responses.map((response) => response.status)).toEqual(
        {
          ok: [200, 200, 200, 200, 200, 200, 200, 200],
          unauthorized: [502, 200, 200, 502, 502, 200, 200, 200],
          network: [503, 200, 200, 503, 503, 200, 200, 200],
        }[mode],
      );
    }
  });

  describe('problem link', () => {
    it('sets the allowed languages to the mapping and records a revision', async () => {
      await createProblem(api, catalog, { code: 'sweet', authors: [editorId] });
      expect(await allowedOf('sweet')).toHaveLength(2);
      const saved = dataOf<{
        connected: boolean;
        link: { isActive: boolean; languages: unknown[]; verifiedAt: unknown };
      }>(await as(editor).put(configOf('sweet'), mapping()).expect(200));
      expect(saved.connected).toBe(true);
      expect(saved.link).toMatchObject({
        isActive: true,
        oj: 'CodeForces',
        problemId: '4A',
        title: 'Watermelon',
        languages: [
          { languageId: catalog.languages.cpp, remoteId: '54', remoteName: '' },
        ],
      });
      expect(saved.link.verifiedAt).not.toBeNull();
      expect(await allowedOf('sweet')).toEqual([catalog.languages.cpp]);
      const revision = await api.revisions.findOne({
        comment: /External judge/,
      });
      expect(Object.keys(revision!.changes)).toEqual(
        expect.arrayContaining(['externalJudge', 'allowedLanguages']),
      );
    });

    it('leaves the allowed languages alone while the link is inactive, and on delete', async () => {
      await createProblem(api, catalog, { code: 'quiet', authors: [editorId] });
      await as(editor)
        .put(configOf('quiet'), { ...mapping(), isActive: false })
        .expect(200);
      expect(await allowedOf('quiet')).toHaveLength(2);
      await as(editor).put(configOf('quiet'), mapping()).expect(200);
      expect(await allowedOf('quiet')).toEqual([catalog.languages.cpp]);
      const removed = dataOf(
        await as(editor).delete(configOf('quiet')).expect(200),
      );
      expect(removed).toEqual({ connected: true, link: null });
      expect(await allowedOf('quiet')).toEqual([catalog.languages.cpp]);
    });

    it('refuses file-only, unknown and repeated languages and keeps the stored link', async () => {
      await createProblem(api, catalog, {
        code: 'strict',
        authors: [editorId],
      });
      const withLanguages = (languages: object[]) => ({
        ...mapping(),
        languages,
      });
      const unknown = '0192b0e0-0000-7000-8000-00000000dead';
      for (const languages of [
        [{ languageId: catalog.languages.text, remoteId: '1' }],
        [{ languageId: unknown, remoteId: '1' }],
        [
          { languageId: catalog.languages.cpp, remoteId: '1' },
          { languageId: catalog.languages.cpp, remoteId: '2' },
        ],
        [{ languageId: catalog.languages.cpp, remoteId: '' }],
      ])
        await as(editor)
          .put(configOf('strict'), withLanguages(languages))
          .expect(400)
          .expect(errorCode('validation_failed'));
      expect(
        dataOf(await as(editor).get(configOf('strict')).expect(200)),
      ).toEqual({ connected: true, link: null });
      expect(await allowedOf('strict')).toHaveLength(2);
    });

    it('suggests a site language for each remote language when verifying', async () => {
      const verified = dataOf(
        await as(editor)
          .post(`${configOf('melon')}/verify`, {
            oj: 'CodeForces',
            problemId: '4A',
          })
          .expect(200),
      );
      expect(verified).toEqual({
        oj: 'CodeForces',
        problemId: '4A',
        title: 'Watermelon',
        languages: [
          {
            remoteId: '54',
            remoteName: 'GNU G++17 7.3.0',
            suggestedLanguageId: catalog.languages.cpp,
          },
          {
            remoteId: '31',
            remoteName: 'Python 3.8',
            suggestedLanguageId: catalog.languages.python,
          },
        ],
      });
    });

    it('searches, and wants an OJ or a problem id', async () => {
      expect(
        dataOf(
          await as(editor)
            .post(`${configOf('melon')}/search`, { problemId: '4A' })
            .expect(200),
        ),
      ).toMatchObject({
        items: [{ oj: 'CodeForces', problemId: '4A' }],
        total: 1,
        page: 1,
        pageSize: 20,
      });
      await as(editor)
        .post(`${configOf('melon')}/search`, {})
        .expect(400)
        .expect(errorCode('validation_failed'));
    });

    it('limits searches and verifications per user', async () => {
      const keys = await redis.keys('rate:external-judge-lookup:*');
      if (keys.length) await redis.del(...keys);
      for (let used = 0; used < EXTERNAL_JUDGE_LOOKUP_LIMIT; used += 1)
        await as(editor)
          .post(`${configOf('melon')}/search`, { oj: 'QOJ' })
          .expect(200);
      await as(editor)
        .post(`${configOf('melon')}/verify`, { oj: 'QOJ', problemId: '1' })
        .expect(429);
    });
  });

  describe('judging', () => {
    beforeAll(async () => {
      await as(editor).put(configOf('melon'), mapping()).expect(200);
    });

    it('shows the OJ on the public problem and refuses a judge pin and a file', async () => {
      const detail = await api
        .http()
        .get('/api/internal/problems/melon')
        .expect(200);
      expect(dataOf<{ externalJudge: unknown }>(detail).externalJudge).toEqual({
        oj: 'CodeForces',
      });
      const pinned = await as(editor)
        .post('/api/internal/problems/melon/submit', {
          language: catalog.languages.cpp,
          source: 'int main(){}',
          judgeId: 'judge-1',
        })
        .expect(400);
      expect(
        (pinned.body as { error: { issues: Array<{ code: string }> } }).error
          .issues[0].code,
      ).toBe('external_problem_no_judge_pin');
      const file = await authed(
        api.http().post('/api/internal/problems/melon/submit/file'),
        plain,
      )
        .field('language', catalog.languages.text)
        .attach('file', Buffer.from('x'), 'a.txt')
        .expect(400);
      expect(
        (file.body as { error: { issues: Array<{ code: string }> } }).error
          .issues[0].code,
      ).toBe('external_problem_no_file');
    });

    it('shows the external run only to viewers who may rejudge, and only for the current generation', async () => {
      const owner = (await api.users.findOne({ username: 'plain' }))!;
      const problem = (await api.problems.findOne({ code: 'melon' }))!;
      const submission = await seedSubmission(api, {
        user: owner._id,
        problem: problem._id,
        language: catalog.languages.cpp,
        judgeGeneration: 2,
      });
      const run = {
        _id: submission._id,
        generation: 2,
        oj: 'CodeForces',
        problemId: '4A',
        remoteLanguage: '54',
        remoteId: 'r-1',
        systemStatus: 'done',
        statusCanonical: 'AC',
        scoreText: '100/100',
        remoteUrl: 'https://codeforces.example.test/s/1',
        submittedAt: new Date('2026-10-11T08:00:00.000Z'),
      };
      await runs.create(run);
      const detailAs = async (session: TestSession) =>
        dataOf<{ externalRun: unknown }>(
          await as(session)
            .get(`/api/internal/submissions/${submission._id}`)
            .expect(200),
        ).externalRun;
      expect(await detailAs(rejudger)).toEqual({
        oj: 'CodeForces',
        problemId: '4A',
        remoteId: 'r-1',
        systemStatus: 'done',
        statusCanonical: 'AC',
        scoreText: '100/100',
        remoteUrl: 'https://codeforces.example.test/s/1',
        submittedAt: '2026-10-11T08:00:00.000Z',
      });
      expect(await detailAs(plain)).toBeNull();
      await runs.updateOne({ _id: submission._id }, { generation: 1 });
      expect(await detailAs(rejudger)).toBeNull();
    });
  });
});
