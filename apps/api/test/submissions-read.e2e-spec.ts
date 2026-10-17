import type { Problem, Submission, SubmissionCase } from '@libs/database';
import {
  authed,
  createProblem,
  createUserWith,
  loginAs,
  seedCatalog,
} from './problem-fixtures';
import type { Catalog, TestSession } from './problem-fixtures';
import { SubmissionsRepository } from '../src/modules/submissions/core/submissions.repository';
import {
  VISITOR_DETAIL_LIMIT,
  visitorDetailKey,
} from '../src/modules/submissions/core/rate-limits';
import { dataOf, seedSubmission } from './submission-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type Redis from 'ioredis';
import { REDIS } from '@libs/common';
import { uuidStr } from '@libs/database';
import { buildZip } from '@libs/problems/testing';

let api: ApiTest;

beforeAll(async () => {
  api = await setupApiTest();
});
afterAll(() => api.teardown());

// from submissions-read.e2e-spec.ts
{
  const SUBMISSIONS = '/api/internal/submissions';
  const CASES: SubmissionCase[] = [
    {
      position: 1,
      status: 'AC',
      time: 0.1,
      memory: 100,
      points: 1,
      total: 1,
      batch: null,
      feedback: 'ok',
      extendedFeedback: 'checker ok',
      output: '42',
    },
    {
      position: 2,
      status: 'AC',
      time: 0.2,
      memory: 200,
      points: 2,
      total: 2,
      batch: 1,
      feedback: '',
      extendedFeedback: '',
      output: '',
    },
    {
      position: 3,
      status: 'WA',
      time: 0.3,
      memory: 300,
      points: 0,
      total: 2,
      batch: 1,
      feedback: 'wrong',
      extendedFeedback: '',
      output: '41',
    },
  ];

  describe('submission read flow', () => {
    beforeAll(() => api.reset());
    let catalog: Catalog;
    const sessions: Record<string, TestSession> = {};
    const ids: Record<string, string> = {};
    /** The owner's submission on each problem, keyed by problem code. */
    const owned: Record<string, string> = {};
    const as = (who: string, path: string) =>
      who === 'anonymous'
        ? api.http().get(path)
        : authed(api.http().get(path), sessions[who]);
    const listed = async (who: string, query: string) =>
      (await as(who, `${SUBMISSIONS}?${query}`).expect(200)).body as {
        data: Array<{ id: string; result: string; user: { username: string } }>;
        meta: { total: number };
      };
    const problemWith = (code: string, extra: Partial<Problem> = {}) =>
      createProblem(api, catalog, {
        code,
        authors: [ids.editor],
        submissionSourceVisibility: 'A',
        ...extra,
      });

    beforeAll(async () => {
      catalog = await seedCatalog(api);
      const roles: Array<[string, object]> = [
        ['owner', {}],
        ['other', {}],
        ['tester', {}],
        ['editor', { permissions: ['judge.edit_own_problem'] }],
        ['viewall', { permissions: ['judge.view_all_submission'] }],
        ['staff', { isStaff: true }],
        ['root', { isSuperuser: true }],
        ['seer', { permissions: ['judge.see_private_problem'] }],
      ];
      for (const [name, extra] of roles) {
        ids[name] = (await createUserWith(api, name, extra))._id;
        sessions[name] = await loginAs(api, ids[name]);
      }
      const problems = [
        await problemWith('vis_a'),
        await problemWith('vis_s', {
          submissionSourceVisibility: 'S',
          points: 1000,
        }),
        await problemWith('vis_f', { submissionSourceVisibility: 'F' }),
        await problemWith('vis_o', {
          submissionSourceVisibility: 'O',
          testers: [ids.tester],
        }),
        await problemWith('priv_s', {
          isPublic: false,
          submissionSourceVisibility: 'S',
        }),
        await problemWith('priv', { isPublic: false, testers: [ids.tester] }),
        await problemWith('res_b', { testcaseResultVisibility: 'B' }),
        await problemWith('res_s', { testcaseResultVisibility: 'S' }),
        await problemWith('feed', {
          allowViewFeedback: true,
          testcaseVisibility: 'A',
        }),
      ];
      for (const problem of problems)
        owned[problem.code] = (
          await seedSubmission(api, {
            user: ids.owner,
            problem: problem._id,
            language: catalog.languages.cpp,
            result: 'WA',
            points: 0,
            casePoints: 3,
            caseTotal: 5,
            cases: CASES,
            source: `// ${problem.code}`,
          })
        )._id;
    });

    describe('GET /submissions', () => {
      it('lets only staff filter by IE, QU, P, G, D and SC', async () => {
        for (const [query, field] of [
          ['status=QU', 'status'],
          ['result=SC', 'result'],
          ['status=D', 'status'],
        ]) {
          const response = await as('other', `${SUBMISSIONS}?${query}`)
            .expect(400)
            .expect(errorCode('validation_failed'));
          expect(
            (response.body as { error: { fields: object } }).error.fields,
          ).toHaveProperty(field);
        }
        const problem = await problemWith('staff_filter');
        const finished = await seedSubmission(api, {
          user: ids.owner,
          problem: problem._id,
          language: catalog.languages.cpp,
          status: 'D',
        });
        await seedSubmission(api, {
          user: ids.owner,
          problem: problem._id,
          language: catalog.languages.cpp,
          status: 'QU',
          result: null,
        });
        expect(
          (await listed('staff', 'status=D&problem=staff_filter')).data.map(
            (row) => row.id,
          ),
        ).toEqual([finished._id]);
      });
    });

    describe('GET /submissions test summaries', () => {
      type Row = {
        id: string;
        testSummary: {
          unit: string;
          statuses: string[];
          batches: (number | null)[];
          more: number;
          total: number | null;
        } | null;
      };
      const summaryOf = async (who: string, code: string) => {
        const rows = (
          await as(who, `${SUBMISSIONS}?problem=${code}&user=owner`).expect(200)
        ).body as { data: Row[] };
        return rows.data.find((row) => row.id === owned[code])?.testSummary;
      };

      it('gives the viewer the cases or batches the submission page shows, and nothing otherwise', async () => {
        expect(await summaryOf('owner', 'vis_a')).toEqual({
          unit: 'case',
          statuses: ['AC', 'AC', 'WA'],
          batches: [null, 1, 1],
          more: 0,
          total: 0,
        });
        expect(await summaryOf('owner', 'res_b')).toEqual({
          unit: 'batch',
          statuses: ['WA'],
          batches: [1],
          more: 0,
          total: null,
        });
        expect(await summaryOf('owner', 'res_s')).toBeNull();
        expect(await summaryOf('anonymous', 'vis_a')).toBeNull();
        expect(await summaryOf('other', 'vis_s')).toBeNull();
        expect(await summaryOf('other', 'vis_a')).toMatchObject({
          unit: 'case',
        });
        expect(await summaryOf('root', 'res_s')).toMatchObject({
          unit: 'case',
        });
      });

      it('caps a row at 100 cases and counts the rest', async () => {
        const problem = await problemWith('many_cases');
        const cases = Array.from({ length: 120 }, (_unused, index) => ({
          ...CASES[0],
          position: index + 1,
        }));
        owned.many_cases = (
          await seedSubmission(api, {
            user: ids.owner,
            problem: problem._id,
            language: catalog.languages.cpp,
            cases,
          })
        )._id;
        const summary = await summaryOf('owner', 'many_cases');
        expect(summary?.statuses).toHaveLength(100);
        expect(summary?.more).toBe(20);
      });

      it('leaves the best-submissions ranking without summaries', async () => {
        const best = (
          await as(
            'owner',
            '/api/internal/problems/vis_a/best-submissions',
          ).expect(200)
        ).body as { data: Row[] };
        expect(best.data.every((row) => row.testSummary === null)).toBe(true);
      });
    });

    describe('GET /problems/:code/best-submissions', () => {
      const best = async (who: string, code: string, query = '') =>
        (
          await as(
            who,
            `/api/internal/problems/${code}/best-submissions?${query}`,
          ).expect(200)
        ).body as {
          data: Array<{ id: string; user: { username: string } }>;
          meta: { page: number; pageSize: number; total: number };
        };

      it('ranks each user once by their best submission: points, then time, then memory, then earliest', async () => {
        const problem = await problemWith('best');
        const unlisted = await createUserWith(api, 'unlisted', {
          isUnlisted: true,
        });
        const seed = (user: string, fields: Partial<Submission>) =>
          seedSubmission(api, {
            user,
            problem: problem._id,
            language: catalog.languages.cpp,
            points: 100,
            time: 0.2,
            memory: 50,
            ...fields,
          });
        const at = (minute: number) =>
          new Date(Date.UTC(2026, 0, 1, 0, minute));
        const ownerBest = await seed(ids.owner, { time: 0.5, date: at(1) });
        await seed(ids.owner, { result: 'WA', points: 30, date: at(2) });
        await seed(ids.other, { memory: 100, date: at(3) });
        await seed(ids.tester, { date: at(5) });
        await seed(ids.editor, { date: at(4) });
        await seed(ids.staff, { result: 'WA', points: 40, date: at(6) });
        await seed(ids.seer, { result: 'WA', points: 0 });
        await seed(unlisted._id, { time: 0.01 });
        await seed(ids.root, { status: 'QU', result: null, points: null });

        const page = await best('anonymous', 'best', 'pageSize=100');
        expect(page.data.map((row) => row.user.username)).toEqual([
          'editor',
          'tester',
          'other',
          'owner',
          'staff',
        ]);
        expect(page.data[3].id).toBe(ownerBest._id);
        expect(page.meta.total).toBe(5);
        const second = await best('anonymous', 'best', 'page=2&pageSize=2');
        expect(second.data.map((row) => row.user.username)).toEqual([
          'other',
          'owner',
        ]);
        expect(second.meta).toEqual({ page: 2, pageSize: 2, total: 5 });
      });
    });

    describe('GET /submissions/:id', () => {
      const sourceAccessOf = async (who: string, code: string) =>
        dataOf<{ sourceAccess: string }>(
          await as(who, `${SUBMISSIONS}/${owned[code]}`).expect(200),
        ).sourceAccess;

      it.each([
        ['owner', 'vis_o', 200],
        ['other', 'vis_o', 200],
        ['other', 'vis_f', 200],
        ['anonymous', 'vis_a', 200],
        ['anonymous', 'vis_o', 200],
        ['seer', 'priv_s', 200],
        ['tester', 'priv', 200],
        // The problem must be visible too (user decision; legacy showed source-visibility-A submissions of private problems).
        ['other', 'priv', 404],
        ['owner', 'priv', 404],
        ['anonymous', 'priv', 404],
      ])(
        'opens the result to whoever sees the problem: %s on %s → %i',
        async (who, code, status) => {
          await as(who, `${SUBMISSIONS}/${owned[code]}`).expect(status);
        },
      );

      it.each([
        ['owner', 'vis_o', 'granted'],
        ['other', 'vis_a', 'granted'],
        ['tester', 'vis_o', 'granted'],
        ['editor', 'vis_o', 'granted'],
        ['viewall', 'vis_o', 'granted'],
        ['other', 'vis_o', 'hidden'],
        // F follows the site setting, all-solved.
        ['other', 'vis_f', 'solve_first'],
        ['seer', 'priv_s', 'hidden'],
        ['anonymous', 'vis_a', 'sign_in'],
        ['anonymous', 'vis_o', 'sign_in'],
      ])(
        'tells %s on %s the source access: %s',
        async (who, code, expected) => {
          expect(await sourceAccessOf(who, code)).toBe(expected);
        },
      );

      it('gives a visitor the verdict, points and cases but no action, feedback, output or compile log', async () => {
        const problem = (await api.problems.findOne({ code: 'feed' }))!;
        const compiled = await seedSubmission(api, {
          user: ids.owner,
          problem: problem._id,
          language: catalog.languages.cpp,
          result: 'WA',
          cases: CASES,
          error: 'main.cpp:1:5: warning: unused variable',
        });
        const path = `${SUBMISSIONS}/${uuidStr(compiled._id)}`;
        const visitor = dataOf<{
          result: string;
          error: string | null;
          cases: Array<Record<string, unknown>> | null;
          viewer: Record<string, boolean>;
        }>(await as('anonymous', path).expect(200));
        expect(visitor.result).toBe('WA');
        expect(visitor.error).toBeNull();
        expect(visitor.cases?.map((testCase) => testCase.status)).toEqual([
          'AC',
          'AC',
          'WA',
        ]);
        for (const testCase of visitor.cases ?? []) {
          expect(testCase).not.toHaveProperty('feedback');
          expect(testCase).not.toHaveProperty('output');
        }
        expect(Object.values(visitor.viewer)).not.toContain(true);
        const owner = dataOf<{
          error: string | null;
          cases: Array<Record<string, unknown>> | null;
        }>(await as('owner', path).expect(200));
        expect(owner.error).toBe('main.cpp:1:5: warning: unused variable');
        expect(owner.cases?.[0]).toMatchObject({
          feedback: 'ok',
          output: '42',
        });
      });

      it('limits visitors per IP, never signed-in viewers', async () => {
        const redis = api.app.get<Redis>(REDIS);
        const path = `${SUBMISSIONS}/${owned['vis_a']}`;
        await as('anonymous', path).expect(200);
        const [key] = await redis.keys(`rate:${visitorDetailKey('*')}`);
        expect(Number(await redis.get(key))).toBeGreaterThan(0);
        await redis.set(key, VISITOR_DETAIL_LIMIT, 'KEEPTTL');
        try {
          await as('anonymous', path)
            .expect(429)
            .expect(errorCode('rate_limited'));
          await as('other', path).expect(200);
        } finally {
          await redis.del(key);
        }
      });

      it('keeps feedback and output from a signed-in viewer without source access', async () => {
        const problem = await problemWith('feed_o', {
          allowViewFeedback: true,
          testcaseVisibility: 'A',
          submissionSourceVisibility: 'O',
        });
        const submission = await seedSubmission(api, {
          user: ids.owner,
          problem: problem._id,
          language: catalog.languages.cpp,
          cases: CASES,
        });
        const detail = dataOf<{
          sourceAccess: string;
          cases: Array<Record<string, unknown>> | null;
        }>(
          await as('other', `${SUBMISSIONS}/${uuidStr(submission._id)}`).expect(
            200,
          ),
        );
        expect(detail.sourceAccess).toBe('hidden');
        expect(detail.cases?.[2]).toMatchObject({ status: 'WA', points: 0 });
        expect(detail.cases?.[2]).not.toHaveProperty('feedback');
        expect(detail.cases?.[2]).not.toHaveProperty('output');
      });
    });

    describe('GET /submissions/:id/source', () => {
      it.each([
        ['owner', 'vis_o', 200],
        ['other', 'vis_a', 200],
        ['tester', 'vis_o', 200],
        ['editor', 'vis_o', 200],
        ['viewall', 'vis_o', 200],
        ['other', 'vis_o', 403],
        ['other', 'vis_f', 403],
        ['seer', 'priv_s', 403],
        ['other', 'priv', 404],
        ['anonymous', 'vis_a', 401],
      ])('%s on %s → %i', async (who, code, status) => {
        await as(who, `${SUBMISSIONS}/${owned[code]}/source`).expect(status);
      });

      it.each(['raw', 'download'])(
        'keeps the %s file behind the same rule',
        async (kind) => {
          const path = (code: string) =>
            `${SUBMISSIONS}/${owned[code]}/source/${kind}`;
          await as('anonymous', path('vis_a')).expect(401);
          await as('other', path('vis_o'))
            .expect(403)
            .expect(errorCode('hidden'));
          const ok = await as('other', path('vis_a')).expect(200);
          expect(ok.text).toBe('// vis_a');
        },
      );

      it('says hidden, not solve_first, when solving would not help', () =>
        as('other', `${SUBMISSIONS}/${owned['vis_o']}/source`)
          .expect(403)
          .expect(errorCode('hidden')));

      it('says hidden on a non-public problem the viewer can see but is no tester of', () =>
        as('seer', `${SUBMISSIONS}/${owned['priv_s']}/source`)
          .expect(403)
          .expect(errorCode('hidden')));

      it('opens an all-solved source once the viewer solved the problem with full points', async () => {
        const path = `${SUBMISSIONS}/${owned['vis_s']}`;
        const source = `${path}/source`;
        const problem = (await api.problems.findOne({ code: 'vis_s' }))!;
        const accessNow = async () =>
          dataOf<{ sourceAccess: string }>(await as('other', path).expect(200))
            .sourceAccess;
        // Neither someone else's full-score AC nor the viewer's own full-score non-AC counts.
        await seedSubmission(api, {
          user: ids.tester,
          problem: problem._id,
          language: catalog.languages.cpp,
          result: 'AC',
          points: 1000,
        });
        await seedSubmission(api, {
          user: ids.other,
          problem: problem._id,
          language: catalog.languages.cpp,
          result: 'WA',
          points: 1000,
        });
        await as('other', source).expect(403).expect(errorCode('solve_first'));
        expect(await accessNow()).toBe('solve_first');
        await seedSubmission(api, {
          user: ids.other,
          problem: problem._id,
          language: catalog.languages.cpp,
          result: 'AC',
          points: 999,
        });
        await as('other', source).expect(403);
        await seedSubmission(api, {
          user: ids.other,
          problem: problem._id,
          language: catalog.languages.cpp,
          result: 'AC',
          points: 1000,
        });
        await as('other', source).expect(200);
        expect(await accessNow()).toBe('granted');
      });
    });

    describe('GET /submissions/:id cases', () => {
      it('loads cases only for a viewer who passed the check and sees them', async () => {
        const findById = jest.spyOn(
          api.app.get(SubmissionsRepository),
          'findById',
        );
        const casesLoaded = () =>
          findById.mock.calls.filter(([, withCases]) => withCases).length;
        for (const [who, code, status] of [
          ['other', 'priv', 404],
          ['anonymous', 'priv', 404],
          ['owner', 'res_s', 200],
          ['anonymous', 'res_s', 200],
        ] as const) {
          findById.mockClear();
          await as(who, `${SUBMISSIONS}/${owned[code]}`).expect(status);
          expect(casesLoaded()).toBe(0);
        }
        for (const who of ['owner', 'anonymous']) {
          findById.mockClear();
          await as(who, `${SUBMISSIONS}/${owned['vis_a']}`).expect(200);
          expect(casesLoaded()).toBe(1);
        }
        findById.mockRestore();
      });

      it('withholds the judged-case position with the case results', async () => {
        const positionFor = async (who: string, code: string) => {
          await api.submissions.updateOne(
            { _id: owned[code] },
            { currentTestcase: 3 },
          );
          return dataOf<{ currentTestcase: number | null }>(
            await as(who, `${SUBMISSIONS}/${owned[code]}`).expect(200),
          ).currentTestcase;
        };
        expect(await positionFor('owner', 'res_s')).toBeNull();
        expect(await positionFor('owner', 'res_b')).toBeNull();
        expect(await positionFor('root', 'res_s')).toBe(3);
        expect(await positionFor('owner', 'vis_a')).toBe(3);
      });

      it('shapes cases by the problem: all, batch summaries or nothing; feedback and output when allowed', async () => {
        const detail = async (who: string, code: string) =>
          dataOf<{
            cases: Array<Record<string, unknown>> | null;
            batches: unknown[] | null;
          }>(await as(who, `${SUBMISSIONS}/${owned[code]}`).expect(200));
        const plain = await detail('owner', 'vis_a');
        expect(plain.cases?.map((testCase) => testCase.status)).toEqual([
          'AC',
          'AC',
          'WA',
        ]);
        expect(plain.cases?.[0]).not.toHaveProperty('feedback');
        expect(plain.cases?.[0]).not.toHaveProperty('output');
        expect(plain.batches).toBeNull();
        expect((await detail('owner', 'feed')).cases?.[0]).toMatchObject({
          feedback: 'ok',
          extendedFeedback: 'checker ok',
          output: '42',
        });
        expect(await detail('owner', 'res_b')).toMatchObject({
          cases: null,
          batches: [{ batch: 1, status: 'WA', points: 0, total: 2 }],
        });
        expect(await detail('owner', 'res_s')).toMatchObject({
          cases: null,
          batches: null,
        });
        expect((await detail('root', 'res_s')).cases?.[2]).toMatchObject({
          feedback: 'wrong',
        });
      });
    });
  });
}

// from submissions-file.e2e-spec.ts
{
  const UUID =
    '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
  const PROJECT = Buffer.from('{"targets":[],"meta":{"semver":"3.0.0"}}');

  const issueCodes = (response: { body: unknown }) =>
    (
      response.body as { error: { issues: Array<{ code: string }> } }
    ).error.issues.map((issue) => issue.code);

  describe('POST /api/internal/problems/:code/submit/file', () => {
    beforeAll(() => api.reset());
    let catalog: Catalog;
    let uploader: { _id: string };
    let session: TestSession;
    const languages: Record<'zip' | 'scratch' | 'off' | 'html', string> = {
      html: '',
      zip: '',
      scratch: '',
      off: '',
    };
    const submitFile = (
      language: string,
      content: Buffer,
      filename: string,
      who: TestSession = session,
    ) =>
      authed(api.http().post('/api/internal/problems/files/submit/file'), who)
        .field('language', language)
        .attach('file', content, filename);
    const uploadDirectory = () =>
      join(api.mediaRoot, 'submission_file', 'files', uploader._id);
    const storedFiles = () =>
      existsSync(uploadDirectory()) ? readdirSync(uploadDirectory()) : [];
    const storedSource = async (id: string) =>
      (await api.submissionSources.findById(id).lean())!.source;

    beforeAll(async () => {
      catalog = await seedCatalog(api);
      const fileLanguage = (key: string, extension: string, limit: number) => ({
        key,
        name: key,
        commonName: key,
        ace: 'text',
        pygments: 'text',
        extension,
        fileOnly: true,
        fileSizeLimit: limit,
      });
      [languages.zip, languages.scratch, languages.off, languages.html] = (
        await api.languages.create([
          fileLanguage('ZIPPED', 'zip', 1),
          fileLanguage('SCRATCH', 'sb3', 1),
          fileLanguage('ZIP0', 'zip', 0),
          fileLanguage('PAGE', 'htm', 1),
        ])
      ).map((language) => language._id);
      await api.resyncCatalog();
      uploader = await createUserWith(api, 'uploader', {
        permissions: ['judge.spam_submission'],
      });
      const bannedUser = await createUserWith(api, 'banned');
      await createProblem(api, catalog, {
        code: 'files',
        allowedLanguages: [catalog.languages.cpp, ...Object.values(languages)],
        bannedUsers: [bannedUser._id],
      });
      session = await loginAs(api, uploader._id);
    });
    beforeEach(async () => {
      const redis = api.app.get<Redis>(REDIS);
      const spent = await redis.keys('rate:*');
      if (spent.length) await redis.del(...spent);
    });
    afterEach(() => jest.restoreAllMocks());

    it('stores the upload under submission_file and keeps its media URL as the source', async () => {
      const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 10, 13]);
      const { id } = dataOf<{ id: string }>(
        await submitFile(languages.zip, bytes, 'answer.ZIP').expect(201),
      );
      const source = await storedSource(id);
      expect(source).toMatch(
        new RegExp(
          `^/media/submission_file/files/${uploader._id}/${UUID}\\.zip$`,
        ),
      );
      const name = source.split('/').pop()!;
      expect(readFileSync(join(uploadDirectory(), name))).toEqual(bytes);
      expect(
        dataOf<{ source: string }>(
          await authed(
            api.http().get(`/api/internal/submissions/${id}/source`),
            session,
          ).expect(200),
        ).source,
      ).toBe(source);
      const row = (await api.submissions.findById(id).lean())!;
      expect([row.status, uuidStr(row.language)]).toEqual([
        'QU',
        languages.zip,
      ]);
    });

    it.each([
      [
        'without project.json',
        buildZip([{ name: 'costume.svg', content: 'x' }]),
      ],
      [
        'with a path escaping the archive',
        buildZip([
          { name: '../project.json', content: PROJECT },
          { name: 'project.json', content: PROJECT },
        ]),
      ],
      [
        'whose project.json inflates past its declared size',
        buildZip([
          {
            name: 'project.json',
            content: Buffer.alloc(64 * 1024),
            method: 'deflate',
            declaredSize: 1024,
          },
        ]),
      ],
      ['that is not a zip', Buffer.from('not a zip at all')],
    ])('refuses a Scratch upload %s', async (_label, sb3) => {
      const before = await api.submissions.countDocuments();
      const files = storedFiles().length;
      const response = await submitFile(
        languages.scratch,
        sb3,
        'game.sb3',
      ).expect(400);
      expect(issueCodes(response)).toEqual(['scratch_project_invalid']);
      expect(await api.submissions.countDocuments()).toBe(before);
      expect(storedFiles()).toHaveLength(files);
    });
  });
}
