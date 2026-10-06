import type { Submission, SubmissionCase } from '@libs/database';
import {
  authed,
  createProblem,
  createUserWith,
  loginAs,
  seedCatalog,
} from './problem-fixtures';
import type { Catalog, TestSession } from './problem-fixtures';
import { seedSubmission } from './submission-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

const V2 = '/api/v2';
type Envelope = {
  data?: {
    objects?: Array<Record<string, unknown>>;
    object?: Record<string, unknown>;
    has_more?: boolean;
    total_objects?: number;
    total_pages?: number;
  };
  error?: { code: number; message: string };
};
const bodyOf = ({ body }: { body: unknown }) => body as Envelope;
const CASES: SubmissionCase[] = [
  {
    position: 1,
    status: 'AC',
    time: 0.1,
    memory: 10,
    points: 1,
    total: 1,
    batch: null,
    feedback: 'fb',
    extendedFeedback: '',
    output: 'out',
  },
  {
    position: 2,
    status: 'AC',
    time: 0.2,
    memory: 20,
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
    memory: 30,
    points: 0,
    total: 2,
    batch: 1,
    feedback: '',
    extendedFeedback: '',
    output: '',
  },
];

describe('/api/v2 submissions', () => {
  let api: ApiTest;
  let catalog: Catalog;
  let alice: TestSession;
  let bob: TestSession;
  const ids: Record<string, string> = {};
  const problems: Record<string, string> = {};
  const listed = (query = '') =>
    api.http().get(`${V2}/submissions${query}`).expect(200).then(bodyOf);
  const submitAs = (
    user: string,
    problem: string,
    fields: Partial<Submission> = {},
  ) =>
    seedSubmission(api, {
      user: ids[user],
      problem: problems[problem],
      language: catalog.languages.cpp,
      points: 1000,
      casePoints: 3,
      caseTotal: 3,
      time: 0.3,
      memory: 30,
      ...fields,
    });

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
    for (const name of ['alice', 'bob', 'carol'])
      ids[name] = (await createUserWith(api, name))._id;
    alice = await loginAs(api, ids.alice);
    bob = await loginAs(api, ids.bob);
    for (const [code, extra] of [
      ['pub', {}],
      ['priv', { isPublic: false }],
      ['pub_s', { testcaseResultVisibility: 'S' }],
      ['pub_b', { testcaseResultVisibility: 'B' }],
    ] as const)
      problems[code] = (
        await createProblem(api, catalog, { code, ...extra })
      )._id;
    ids.first = (await submitAs('alice', 'pub', { cases: CASES }))._id;
    ids.second = (
      await submitAs('alice', 'pub', { result: 'WA', points: 0 })
    )._id;
    ids.python = (
      await submitAs('alice', 'pub', {
        status: 'CE',
        result: 'CE',
        points: 0,
        language: catalog.languages.python,
      })
    )._id;
    ids.bobs = (await submitAs('bob', 'pub', { result: 'WA', points: 0 }))._id;
    ids.hidden = (await submitAs('alice', 'priv'))._id;
    ids.summary = (await submitAs('alice', 'pub_s', { cases: CASES }))._id;
    ids.batches = (await submitAs('alice', 'pub_b', { cases: CASES }))._id;
  });
  afterAll(() => api.teardown());

  it('lists visible submissions oldest first in the legacy shape, infinitely without a user or problem filter', async () => {
    const { data } = await listed();
    expect(data!.objects!.map((object) => object.id)).toEqual([
      ids.first,
      ids.second,
      ids.python,
      ids.bobs,
      ids.summary,
      ids.batches,
    ]);
    expect(data).not.toHaveProperty('total_objects');
    expect(data).toMatchObject({ has_more: false, objects_per_page: 1000 });
    expect(data!.objects![0]).toEqual({
      id: ids.first,
      problem: 'pub',
      user: 'alice',
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*\+00:00$/) as string,
      language: 'CPP17',
      time: 0.3,
      memory: 30,
      points: 1000,
      result: 'AC',
    });
  });

  it('applies the legacy filters, with totals once a user or problem is given', async () => {
    const idsOf = async (query: string) =>
      (await listed(query)).data!.objects!.map((object) => object.id);
    expect(await idsOf('?user=alice&problem=pub')).toEqual([
      ids.first,
      ids.second,
      ids.python,
    ]);
    expect((await listed('?user=alice')).data).toMatchObject({
      total_objects: 5,
      total_pages: 1,
    });
    expect(await idsOf('?problem=pub&language=PY3')).toEqual([ids.python]);
    expect(await idsOf('?problem=pub&result=WA&result=CE')).toEqual([
      ids.second,
      ids.python,
      ids.bobs,
    ]);
    for (const query of [
      '?user=nobody',
      '?problem=priv',
      '?problem=nope',
      '?language=NOPE',
      '?result=XX',
    ])
      expect(await idsOf(query)).toEqual([]);
  });

  it('answers 404 past the last page, finite or infinite', async () => {
    for (const query of ['?user=alice&page=2', '?page=2']) {
      const response = await api
        .http()
        .get(`${V2}/submissions${query}`)
        .expect(404);
      expect(bodyOf(response).error).toEqual({
        code: 404,
        message: 'page/object not found',
      });
    }
  });

  it('pages 1000 at a time', async () => {
    await api.submissions.insertMany(
      Array.from({ length: 1001 }, () => ({
        user: ids.carol,
        problem: problems.pub,
        language: catalog.languages.cpp,
        status: 'D',
        result: 'AC',
      })),
    );
    expect((await listed('?user=carol')).data).toMatchObject({
      current_object_count: 1000,
      has_more: true,
      total_objects: 1001,
      total_pages: 2,
    });
    expect((await listed('?user=carol&page=2')).data).toMatchObject({
      current_object_count: 1,
      has_more: false,
    });
    expect((await listed()).data).toMatchObject({
      current_object_count: 1000,
      has_more: true,
    });
  });

  it('details need a login and detail rights, and group cases like legacy', async () => {
    expect(
      bodyOf(await api.http().get(`${V2}/submission/${ids.first}`).expect(403))
        .error,
    ).toEqual({ code: 403, message: 'login required' });
    expect(
      bodyOf(
        await authed(
          api.http().get(`${V2}/submission/${ids.first}`),
          bob,
        ).expect(403),
      ).error,
    ).toEqual({ code: 403, message: 'permission denied' });
    for (const id of [ids.hidden, 'not-an-id'])
      await authed(api.http().get(`${V2}/submission/${id}`), alice).expect(404);
    const { object } = bodyOf(
      await authed(
        api.http().get(`${V2}/submission/${ids.first}`),
        alice,
      ).expect(200),
    ).data!;
    expect(object).toMatchObject({
      id: ids.first,
      problem: 'pub',
      user: 'alice',
      language: 'CPP17',
      status: 'D',
      result: 'AC',
      case_points: 3,
      case_total: 3,
    });
    expect(object!.cases).toEqual([
      {
        type: 'case',
        case_id: 1,
        status: 'AC',
        time: 0.1,
        memory: 10,
        points: 1,
        total: 1,
      },
      {
        type: 'batch',
        batch_id: 1,
        points: 0,
        total: 2,
        cases: [
          {
            type: 'case',
            case_id: 2,
            status: 'AC',
            time: 0.2,
            memory: 20,
            points: 2,
            total: 2,
          },
          {
            type: 'case',
            case_id: 3,
            status: 'WA',
            time: 0.3,
            memory: 30,
            points: 0,
            total: 2,
          },
        ],
      },
    ]);
  });

  it('hides the cases a problem does not show', async () => {
    const casesOf = async (id: string) =>
      bodyOf(
        await authed(api.http().get(`${V2}/submission/${id}`), alice).expect(
          200,
        ),
      ).data!.object!.cases;
    expect(await casesOf(ids.summary)).toEqual([]);
    expect(await casesOf(ids.batches)).toEqual([
      { type: 'batch', batch_id: 1, cases: [], points: 0, total: 2 },
    ]);
  });
});
