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
      it.each([
        ['owner', 'vis_o', 200],
        ['other', 'vis_a', 200],
        ['other', 'vis_o', 403],
        ['tester', 'vis_o', 200],
        ['editor', 'vis_o', 200],
        ['viewall', 'vis_o', 200],
        ['other', 'vis_f', 403],
        // The problem must be visible too (user decision; legacy showed source-visibility-A submissions of private problems).
        ['other', 'priv', 404],
        ['owner', 'priv', 404],
        ['tester', 'priv', 200],
      ])('%s on %s → %i', async (who, code, status) => {
        await as(who, `${SUBMISSIONS}/${owned[code]}`).expect(status);
      });

      it('says hidden, not solve_first, when solving would not help', () =>
        as('other', `${SUBMISSIONS}/${owned['vis_o']}`)
          .expect(403)
          .expect(errorCode('hidden')));

      it('says hidden on a non-public problem the viewer can see but is no tester of', () =>
        as('seer', `${SUBMISSIONS}/${owned['priv_s']}`)
          .expect(403)
          .expect(errorCode('hidden')));

      it('opens an all-solved submission once the viewer solved the problem with full points', async () => {
        const path = `${SUBMISSIONS}/${owned['vis_s']}`;
        const problem = (await api.problems.findOne({ code: 'vis_s' }))!;
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
        await as('other', path).expect(403).expect(errorCode('solve_first'));
        await seedSubmission(api, {
          user: ids.other,
          problem: problem._id,
          language: catalog.languages.cpp,
          result: 'AC',
          points: 999,
        });
        await as('other', path).expect(403);
        await seedSubmission(api, {
          user: ids.other,
          problem: problem._id,
          language: catalog.languages.cpp,
          result: 'AC',
          points: 1000,
        });
        await as('other', path).expect(200);
      });

      it('loads cases only for a viewer who passed the check and sees them', async () => {
        const findById = jest.spyOn(
          api.app.get(SubmissionsRepository),
          'findById',
        );
        const casesLoaded = () =>
          findById.mock.calls.filter(([, withCases]) => withCases).length;
        for (const [who, code, status] of [
          ['other', 'vis_o', 403],
          ['other', 'priv', 404],
          ['owner', 'res_s', 200],
        ] as const) {
          findById.mockClear();
          await as(who, `${SUBMISSIONS}/${owned[code]}`).expect(status);
          expect(casesLoaded()).toBe(0);
        }
        await as('owner', `${SUBMISSIONS}/${owned['vis_a']}`).expect(200);
        expect(casesLoaded()).toBe(1);
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
