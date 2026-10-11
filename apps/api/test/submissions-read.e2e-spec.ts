import type { Problem, Submission, SubmissionCase } from '@libs/database';
import {
  authed,
  createProblem,
  dataFixture,
  createUserWith,
  loginAs,
  seedCatalog,
  testCase,
} from './problem-fixtures';
import type { Catalog, TestSession } from './problem-fixtures';
import { SubmissionsRepository } from '../src/modules/submissions/core/submissions.repository';
import { dataOf, seedSubmission } from './submission-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type Redis from 'ioredis';
import { AppError, REDIS, StorageService } from '@libs/common';
import { uuidStr } from '@libs/database';
import { buildZip } from '@libs/problems/testing';
import { SUBMIT_LIMIT } from '../src/modules/submissions/core/rate-limits';

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
      it('lists newest first with user, problem and language, paginated, without cases or source', async () => {
        const problem = await problemWith('list', { points: 1234 });
        const created: string[] = [];
        for (let index = 0; index < 3; index += 1)
          created.push(
            (
              await seedSubmission(api, {
                user: ids.owner,
                problem: problem._id,
                language: catalog.languages.cpp,
              })
            )._id,
          );
        const page = await listed('anonymous', 'problem=list&pageSize=2');
        expect(page.data.map((row) => row.id)).toEqual([
          created[2],
          created[1],
        ]);
        expect(page.meta).toEqual({ page: 1, pageSize: 2, total: 3 });
        expect(page.data[0]).toMatchObject({
          user: { username: 'owner' },
          problem: { code: 'list', name: 'LIST', points: 1234 },
          language: { key: 'CPP17' },
          status: 'D',
          result: 'AC',
        });
        expect(page.data[0]).not.toHaveProperty('cases');
        expect(page.data[0]).not.toHaveProperty('error');
        expect(JSON.stringify(page)).not.toContain('int main');
      });

      it('shows only submissions on problems the viewer can see', async () => {
        const visibleTo = async (who: string) =>
          (await listed(who, 'user=owner&pageSize=100')).data.map(
            (row) => row.id,
          );
        expect(await visibleTo('anonymous')).not.toContain(owned.priv);
        expect(await visibleTo('other')).not.toContain(owned.priv);
        expect(await visibleTo('tester')).toContain(owned.priv);
        expect(await visibleTo('root')).toContain(owned.priv);
      });

      it('filters by user, problem, language and result', async () => {
        const problem = await problemWith('filters');
        const seed = (user: string, result: 'AC' | 'WA', language: string) =>
          seedSubmission(api, {
            user: ids[user],
            problem: problem._id,
            language,
            result,
          });
        const ownerAccepted = await seed('owner', 'AC', catalog.languages.cpp);
        const ownerWrong = await seed('owner', 'WA', catalog.languages.python);
        const otherAccepted = await seed('other', 'AC', catalog.languages.cpp);
        const idsOf = async (query: string) =>
          (await listed('anonymous', `problem=filters&${query}`)).data.map(
            (row) => row.id,
          );
        expect(await idsOf('result=WA')).toEqual([ownerWrong._id]);
        expect(await idsOf(`language=${catalog.languages.python}`)).toEqual([
          ownerWrong._id,
        ]);
        expect(await idsOf('user=other')).toEqual([otherAccepted._id]);
        expect(await idsOf('result=AC&user=owner')).toEqual([
          ownerAccepted._id,
        ]);
        expect(await idsOf('result=AC&result=WA')).toHaveLength(3);
      });

      it('rejects the nil and max UUIDs, which Mongoose cannot cast, in language with 400', async () => {
        for (const unusable of [
          '00000000-0000-0000-0000-000000000000',
          'ffffffff-ffff-ffff-ffff-ffffffffffff',
        ])
          await as('other', `${SUBMISSIONS}?language=${unusable}`)
            .expect(400)
            .expect(errorCode('validation_failed'));
      });

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

      it('answers an empty page for an unknown user or a problem the viewer cannot see', async () => {
        expect((await listed('anonymous', 'user=nobody')).meta.total).toBe(0);
        expect((await listed('other', 'problem=priv')).meta.total).toBe(0);
        expect((await listed('other', 'problem=Not-A-Code')).meta.total).toBe(
          0,
        );
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

      it('answers 404 for a problem the viewer cannot see', async () => {
        await as('other', '/api/internal/problems/priv/best-submissions')
          .expect(404)
          .expect(errorCode('not_found'));
        await as('anonymous', '/api/internal/problems/nope/best-submissions')
          .expect(404)
          .expect(errorCode('not_found'));
        expect((await best('tester', 'priv')).meta.total).toBe(0);
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

      it('reports the number of test cases, batch members included, markers excluded', async () => {
        await api.problems.updateOne(
          { code: 'res_b' },
          {
            data: dataFixture({
              cases: [
                testCase({ type: 'C' }),
                testCase({ type: 'S' }),
                testCase({ type: 'C' }),
                testCase({ type: 'C' }),
                testCase({ type: 'E' }),
                testCase({ type: 'C' }),
              ],
            }),
          },
        );
        const detail = dataOf<{ totalCases: number | null }>(
          await as('owner', `${SUBMISSIONS}/${owned['res_b']}`).expect(200),
        );
        expect(detail.totalCases).toBe(4);
      });

      it('counts zero for a problem with no data', async () => {
        expect(
          dataOf<{ totalCases: number | null }>(
            await as('owner', `${SUBMISSIONS}/${owned['vis_a']}`).expect(200),
          ).totalCases,
        ).toBe(0);
      });

      it('hides the count with the case results, except from those who see them', async () => {
        await api.problems.updateOne(
          { code: 'res_s' },
          { data: dataFixture({ cases: [testCase({ type: 'C' })] }) },
        );
        const totalFor = async (who: string) =>
          dataOf<{ totalCases: number | null }>(
            await as(who, `${SUBMISSIONS}/${owned['res_s']}`).expect(200),
          ).totalCases;
        expect(await totalFor('owner')).toBeNull();
        expect(await totalFor('editor')).toBeNull();
        expect(await totalFor('root')).toBe(1);
      });

      it('needs a login and answers 404 for unknown and malformed ids', async () => {
        await as('anonymous', `${SUBMISSIONS}/${owned['vis_a']}`).expect(401);
        await as(
          'owner',
          `${SUBMISSIONS}/0192b0e0-0000-7000-8000-00000000dead`,
        ).expect(404);
        await as('owner', `${SUBMISSIONS}/not-an-id`)
          .expect(404)
          .expect(errorCode('not_found'));
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

      it('shows an internal error message to editors only, compile errors to every viewer', async () => {
        const problem = (await api.problems.findOne({ code: 'vis_a' }))!;
        const seed = (status: 'IE' | 'CE', error: string) =>
          seedSubmission(api, {
            user: ids.owner,
            problem: problem._id,
            language: catalog.languages.cpp,
            status,
            result: status,
            error,
          });
        const crashed = await seed('IE', 'Traceback (most recent call last)');
        const broken = await seed('CE', 'error: expected ;');
        const errorFor = async (who: string, id: string) =>
          dataOf<{ error: string | null }>(
            await as(who, `${SUBMISSIONS}/${id}`).expect(200),
          ).error;
        expect(await errorFor('owner', crashed._id)).toBeNull();
        expect(await errorFor('editor', crashed._id)).toBe(
          'Traceback (most recent call last)',
        );
        expect(await errorFor('other', broken._id)).toBe('error: expected ;');
      });
    });

    describe('GET /submissions/:id/source', () => {
      it('returns the source under the detail rules', async () => {
        expect(
          dataOf(
            await as('owner', `${SUBMISSIONS}/${owned['vis_o']}/source`).expect(
              200,
            ),
          ),
        ).toEqual({
          id: owned['vis_o'],
          source: '// vis_o',
        });
        await as('other', `${SUBMISSIONS}/${owned['vis_o']}/source`).expect(
          403,
        );
        await as('anonymous', `${SUBMISSIONS}/${owned['vis_o']}/source`).expect(
          401,
        );
      });
    });
  });
}

// from submissions-file.e2e-spec.ts
{
  const MIB = 1024 * 1024;
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
    let banned: TestSession;
    let bannedId: string;
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
      bannedId = bannedUser._id;
      banned = await loginAs(api, bannedId);
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

    it('caps the file at fileSizeLimit MB and keeps nothing above it', async () => {
      const before = await api.submissions.countDocuments();
      const files = storedFiles().length;
      await submitFile(languages.zip, Buffer.alloc(MIB + 1, 7), 'big.zip')
        .expect(413)
        .expect(errorCode('file_too_large'));
      expect(await api.submissions.countDocuments()).toBe(before);
      expect(storedFiles()).toHaveLength(files);
      await submitFile(languages.zip, Buffer.alloc(MIB, 7), 'edge.zip').expect(
        201,
      );
    });

    it('wants the language extension', async () => {
      const files = storedFiles().length;
      const response = await submitFile(
        languages.zip,
        Buffer.from('x'),
        'answer.tar',
      ).expect(400);
      expect(issueCodes(response)).toEqual(['file_wrong_extension']);
      expect(storedFiles()).toHaveLength(files);
    });

    it('keeps the text and file paths apart', async () => {
      expect(
        issueCodes(
          await submitFile(
            catalog.languages.cpp,
            Buffer.from('int main(){}'),
            'a.cpp',
          ).expect(400),
        ),
      ).toEqual(['language_takes_text']);
      expect(
        issueCodes(
          await submitFile(languages.off, Buffer.from('x'), 'a.zip').expect(
            400,
          ),
        ),
      ).toEqual(['file_upload_disabled']);
      expect(
        issueCodes(
          await authed(
            api.http().post('/api/internal/problems/files/submit'),
            session,
          )
            .send({ language: languages.zip, source: 'x' })
            .expect(400),
        ),
      ).toEqual(['language_takes_file']);
    });

    it('runs the submit checks before anything is stored', async () => {
      const before = await api.submissions.countDocuments();
      await submitFile(languages.zip, Buffer.from('x'), 'a.zip', banned)
        .expect(403)
        .expect(errorCode('banned_from_problem'));
      expect(await api.submissions.countDocuments()).toBe(before);
      expect(
        existsSync(join(api.mediaRoot, 'submission_file', 'files', bannedId)),
      ).toBe(false);
    });

    it('wants the language field and exactly one part named file', async () => {
      const post = () =>
        authed(
          api.http().post('/api/internal/problems/files/submit/file'),
          session,
        );
      const missing = await post()
        .attach('file', Buffer.from('x'), 'a.zip')
        .expect(400);
      expect(
        (
          missing.body as { error: { issues: Array<{ field: string }> } }
        ).error.issues.map((issue) => issue.field),
      ).toEqual(['language']);
      await post().field('language', languages.zip).expect(400);
      await post()
        .field('language', languages.zip)
        .attach('other', Buffer.from('x'), 'a.zip')
        .expect(400);
      await post()
        .field('language', languages.zip)
        .field('source', 'x')
        .attach('file', Buffer.from('x'), 'a.zip')
        .expect(400);
    });

    it('stores the project.json of a Scratch .sb3', async () => {
      const sb3 = buildZip([
        { name: 'project.json', content: PROJECT, method: 'deflate' },
        { name: 'costume.svg', content: '<svg/>' },
      ]);
      const { id } = dataOf<{ id: string }>(
        await submitFile(languages.scratch, sb3, 'game.sb3').expect(201),
      );
      const source = await storedSource(id);
      expect(source).toMatch(new RegExp(`/${UUID}\\.sb3$`));
      expect(
        readFileSync(join(uploadDirectory(), source.split('/').pop()!)),
      ).toEqual(PROJECT);
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

    it('caps the extracted project.json at fileSizeLimit MB', async () => {
      const bomb = buildZip([
        {
          name: 'project.json',
          content: Buffer.alloc(MIB + 1),
          method: 'deflate',
        },
      ]);
      expect(bomb.length).toBeLessThan(MIB);
      await submitFile(languages.scratch, bomb, 'bomb.sb3')
        .expect(413)
        .expect(errorCode('file_too_large'));
    });
    it('spends the submit budget before reading the upload', async () => {
      await api.app
        .get<Redis>(REDIS)
        .set(`rate:submit:user:${uploader._id}`, SUBMIT_LIMIT);
      const files = storedFiles().length;
      await submitFile(languages.zip, Buffer.from('x'), 'a.zip')
        .field('source', 'unexpected field, only seen when the body is read')
        .expect(429)
        .expect(errorCode('rate_limited'));
      await submitFile(languages.zip, Buffer.from('x'), 'a.zip')
        .expect(429)
        .expect(errorCode('rate_limited'));
      expect(storedFiles()).toHaveLength(files);
    });

    it('refuses a language whose stored extension is not plain alphanumeric', async () => {
      await api.languages.updateOne(
        { _id: languages.html },
        { extension: 'HTM/..' },
        { runValidators: false },
      );
      await api.resyncCatalog();
      const files = storedFiles().length;
      const response = await submitFile(
        languages.html,
        Buffer.from('<script>'),
        'page.htm',
      ).expect(400);
      expect(issueCodes(response)).toEqual(['language_extension_invalid']);
      expect(storedFiles()).toHaveLength(files);
      expect(
        await api.submissions.countDocuments({ language: languages.html }),
      ).toBe(0);
    });

    it('removes the stored file when the row cannot be written', async () => {
      const files = storedFiles().length;
      jest
        .spyOn(api.app.get(SubmissionsRepository), 'create')
        .mockRejectedValueOnce(new AppError('insert_failed', 409, 'no row'));
      await submitFile(languages.zip, Buffer.from('x'), 'a.zip')
        .expect(409)
        .expect(errorCode('insert_failed'));
      expect(storedFiles()).toHaveLength(files);
    });

    it('keeps the insert error when removing the file fails too', async () => {
      jest
        .spyOn(api.app.get(SubmissionsRepository), 'create')
        .mockRejectedValueOnce(new AppError('insert_failed', 409, 'no row'));
      jest
        .spyOn(api.app.get(StorageService), 'delete')
        .mockRejectedValueOnce(new Error('disk gone'));
      await submitFile(languages.zip, Buffer.from('x'), 'a.zip')
        .expect(409)
        .expect(errorCode('insert_failed'));
    });
  });
}
