import {
  TagCatalogResponse,
  TagProblemListItemResponse,
  TagProblemResponse,
} from '../src/modules/tags/dto/tag.response';
import { authed, createUserWith, loginAs } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';

const TAGS = '/api/internal/tags';
const dataOf = <Value>({ body }: { body: unknown }) =>
  (body as { data: Value }).data;
const fieldsOf = ({ body }: { body: unknown }) =>
  (body as { error: { fields: Record<string, string[]> } }).error.fields;

describe('tag catalogue', () => {
  let api: ApiTest;
  let tagger: TestSession,
    rated: TestSession,
    lowRated: TestSession,
    optedOut: TestSession,
    plain: TestSession;
  let taggerId: string;

  beforeAll(async () => {
    api = await setupApiTest();
    const [dp, graph] = await api.tagGroups.create([
      { code: 'dp', name: 'Dynamic programming' },
      { code: 'graph', name: 'Graphs' },
    ]);
    await api.tags.create([
      { code: 'dp-basic', name: 'Basic DP', groupId: dp._id },
      { code: 'knapsack', name: 'Knapsack', groupId: dp._id },
      { code: 'bfs', name: 'BFS', groupId: graph._id },
    ]);
    await api.resyncCatalog();
    taggerId = (
      await createUserWith(api, 'tagger', {
        permissions: ['judge.add_tagproblem'],
      })
    )._id;
    tagger = await loginAs(api, taggerId);
    rated = await loginAs(
      api,
      (await createUserWith(api, 'rated', { rating: 2000 }))._id,
    );
    lowRated = await loginAs(
      api,
      (await createUserWith(api, 'lowrated', { rating: 1899 }))._id,
    );
    optedOut = await loginAs(
      api,
      (
        await createUserWith(api, 'optedout', {
          rating: 2500,
          allowTagging: false,
        })
      )._id,
    );
    plain = await loginAs(api, (await createUserWith(api, 'plain'))._id);
  });
  afterAll(() => api.teardown());

  it('creates a tag problem from a supported link, deriving code and judge', async () => {
    const created = dataOf<TagProblemResponse>(
      await authed(api.http().post(TAGS), tagger)
        .send({
          link: 'https://codeforces.com/problemset/problem/1/A',
          name: 'Theatre Square',
        })
        .expect(201),
    );
    expect(created).toMatchObject({
      code: 'CF_1_A',
      name: 'Theatre Square',
      judge: 'Codeforces',
      link: 'https://codeforces.com/problemset/problem/1/A',
      tags: [],
      assignments: [],
    });
    await authed(api.http().post(TAGS), tagger)
      .send({
        link: 'https://codeforces.com/contest/1/problem/A',
        name: 'Again',
      })
      .expect(409)
      .expect(errorCode('conflict'));
    expect(
      fieldsOf(
        await authed(api.http().post(TAGS), tagger)
          .send({ link: 'https://example.com/p/1', name: 'X' })
          .expect(400),
      ),
    ).toHaveProperty('link');
    expect(
      fieldsOf(
        await authed(api.http().post(TAGS), tagger)
          .send({ link: 'not a url', name: 'X' })
          .expect(400),
      ),
    ).toHaveProperty('link');
    expect(
      await api.revisions.countDocuments({
        entity: 'tagProblem',
        action: 'create',
      }),
    ).toBe(1);
  });
  it('lets rating >= 1900 tag, unless tagging is disabled on the profile', async () => {
    await authed(api.http().post(TAGS), rated)
      .send({
        link: 'https://atcoder.jp/contests/abc001/tasks/abc001_a',
        name: 'ABC 1 A',
      })
      .expect(201);
    await authed(api.http().post(TAGS), lowRated)
      .send({ link: 'https://open.kattis.com/problems/hello', name: 'Hello' })
      .expect(403)
      .expect(errorCode('forbidden'));
    await authed(api.http().post(TAGS), optedOut)
      .send({ link: 'https://open.kattis.com/problems/hello', name: 'Hello' })
      .expect(403);
    await authed(api.http().post(TAGS), plain)
      .send({ link: 'https://open.kattis.com/problems/hello', name: 'Hello' })
      .expect(403);
    await api
      .http()
      .post(TAGS)
      .send({ link: 'https://open.kattis.com/problems/hello', name: 'Hello' })
      .expect(401);
  });
  it('assigns tags idempotently and records the assigner', async () => {
    const assigned = dataOf<TagProblemResponse>(
      await authed(api.http().post(`${TAGS}/CF_1_A/assign`), tagger)
        .send({ tagCodes: ['dp-basic', 'bfs'] })
        .expect(200),
    );
    expect(assigned.tags.map((tag) => tag.code)).toEqual(['bfs', 'dp-basic']);
    expect(
      assigned.assignments.map((assignment) => assignment.assigner?.username),
    ).toEqual(['tagger', 'tagger']);
    const again = dataOf<TagProblemResponse>(
      await authed(api.http().post(`${TAGS}/CF_1_A/assign`), rated)
        .send({ tagCodes: ['dp-basic', 'knapsack'] })
        .expect(200),
    );
    expect(again.tags.map((tag) => tag.code)).toEqual([
      'bfs',
      'dp-basic',
      'knapsack',
    ]);
    expect(
      again.assignments.find((assignment) => assignment.tag.code === 'knapsack')
        ?.assigner?.username,
    ).toBe('rated');
    expect(
      fieldsOf(
        await authed(api.http().post(`${TAGS}/CF_1_A/assign`), tagger)
          .send({ tagCodes: ['nope'] })
          .expect(400),
      ),
    ).toHaveProperty('tagCodes');
    await authed(api.http().post(`${TAGS}/GHOST/assign`), tagger)
      .send({ tagCodes: ['bfs'] })
      .expect(404);
    await authed(api.http().post(`${TAGS}/CF_1_A/assign`), lowRated)
      .send({ tagCodes: ['bfs'] })
      .expect(403);
    expect(
      await api.revisions.countDocuments({
        entity: 'tagProblem',
        action: 'assign',
      }),
    ).toBe(2);
  });
  it('lists publicly with search, tag and judge filters, sorted by code', async () => {
    const all = (await api.http().get(TAGS).expect(200)).body as {
      data: TagProblemListItemResponse[];
      meta: { total: number };
    };
    expect(all.data.map((item) => item.code)).toEqual([
      'AC_abc001_a',
      'CF_1_A',
    ]);
    expect(all.meta.total).toBe(2);
    expect(all.data[1].tags.map((tag) => tag.code)).toEqual([
      'bfs',
      'dp-basic',
      'knapsack',
    ]);
    expect(
      dataOf<TagProblemListItemResponse[]>(
        await api.http().get(`${TAGS}?tag=bfs`).expect(200),
      ).map((item) => item.code),
    ).toEqual(['CF_1_A']);
    expect(
      dataOf<TagProblemListItemResponse[]>(
        await api.http().get(`${TAGS}?search=theatre`).expect(200),
      ).map((item) => item.code),
    ).toEqual(['CF_1_A']);
    expect(
      dataOf<TagProblemListItemResponse[]>(
        await api.http().get(`${TAGS}?search=c(`).expect(200),
      ),
    ).toEqual([]);
    expect(
      dataOf<TagProblemListItemResponse[]>(
        await api
          .http()
          .get(`${TAGS}?judges=Atcoder&judges=Kattis`)
          .expect(200),
      ).map((item) => item.code),
    ).toEqual(['AC_abc001_a']);
    await api.http().get(`${TAGS}?pageSize=101`).expect(400);
  });
  it('serves the catalogue and the detail publicly', async () => {
    const catalog = dataOf<TagCatalogResponse>(
      await api.http().get(`${TAGS}/catalog`).expect(200),
    );
    expect(
      catalog.groups.map((group) => [
        group.code,
        group.tags.map((tag) => tag.code),
      ]),
    ).toEqual([
      ['dp', ['dp-basic', 'knapsack']],
      ['graph', ['bfs']],
    ]);
    const detail = dataOf<TagProblemResponse>(
      await api.http().get(`${TAGS}/CF_1_A`).expect(200),
    );
    expect(detail.assignments).toHaveLength(3);
    expect(detail.assignments[0]).toEqual({
      tag: {
        id: expect.any(String) as string,
        code: 'bfs',
        name: 'BFS',
        groupId: expect.any(String) as string,
      },
      assigner: { id: taggerId, username: 'tagger' },
    });
    await api.http().get(`${TAGS}/GHOST`).expect(404);
    await api.http().get(`${TAGS}/not%20a%20code`).expect(404);
  });
});
