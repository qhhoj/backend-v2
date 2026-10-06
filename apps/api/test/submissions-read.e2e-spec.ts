import type { Problem, SubmissionCase } from '@libs/database';
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
  let api: ApiTest;
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
    api = await setupApiTest();
    catalog = await seedCatalog(api);
    const roles: Array<[string, object]> = [
      ['owner', {}],
      ['other', {}],
      ['tester', {}],
      ['editor', { permissions: ['judge.edit_own_problem'] }],
      ['viewall', { permissions: ['judge.view_all_submission'] }],
      ['staff', { isStaff: true }],
      ['root', { isSuperuser: true }],
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
  afterAll(() => api.teardown());

  describe('GET /submissions', () => {
    it('lists newest first with user, problem and language, paginated, without cases or source', async () => {
      const problem = await problemWith('list');
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
      expect(page.data.map((row) => row.id)).toEqual([created[2], created[1]]);
      expect(page.meta).toEqual({ page: 1, pageSize: 2, total: 3 });
      expect(page.data[0]).toMatchObject({
        user: { username: 'owner' },
        problem: { code: 'list', name: 'LIST' },
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
      expect(await idsOf('result=AC&user=owner')).toEqual([ownerAccepted._id]);
      expect(await idsOf('result=AC&result=WA')).toHaveLength(3);
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
      expect(
        (await listed('staff', 'status=D&problem=vis_a')).data.map(
          (row) => row.id,
        ),
      ).toEqual([owned['vis_a']]);
    });

    it('answers an empty page for an unknown user or a problem the viewer cannot see', async () => {
      expect((await listed('anonymous', 'user=nobody')).meta.total).toBe(0);
      expect((await listed('other', 'problem=priv')).meta.total).toBe(0);
      expect((await listed('other', 'problem=Not-A-Code')).meta.total).toBe(0);
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

    it('opens an all-solved submission once the viewer solved the problem with full points', async () => {
      const path = `${SUBMISSIONS}/${owned['vis_s']}`;
      await as('other', path).expect(403).expect(errorCode('forbidden'));
      const problem = (await api.problems.findOne({ code: 'vis_s' }))!;
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
      await as('other', `${SUBMISSIONS}/${owned['vis_o']}/source`).expect(403);
      await as('anonymous', `${SUBMISSIONS}/${owned['vis_o']}/source`).expect(
        401,
      );
    });
  });
});
