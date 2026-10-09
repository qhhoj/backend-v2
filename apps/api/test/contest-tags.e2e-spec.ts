import type { ContestTagResponse } from '../src/modules/contests/tags/dto/contest-tag.response';
import { createContest } from './contest-fixtures';
import { authed, createUserWith, loginAs } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';
import { dataOf } from './submission-fixtures';

describe('contest tag catalogue', () => {
  let api: ApiTest;
  let admin: TestSession;
  let plain: TestSession;
  const url = '/api/internal/contest-tags';
  const create = (body: object, session: TestSession = admin) =>
    authed(api.http().post(url), session).send(body);
  const list = async () =>
    dataOf<ContestTagResponse[]>(await api.http().get(url).expect(200));

  beforeAll(async () => {
    api = await setupApiTest();
    admin = await loginAs(
      api,
      (
        await createUserWith(api, 'tag_admin', {
          permissions: ['judge.change_contest_tag'],
        })
      )._id,
    );
    plain = await loginAs(api, (await createUserWith(api, 'tag_plain'))._id);
  });
  afterAll(() => api.teardown());
  beforeEach(async () => {
    await api.contestTags.deleteMany({});
    await api.resyncCatalog();
  });

  it('lists the catalogue to anyone, ordered by order then slug', async () => {
    await api.contestTags.create([
      { slug: 'zeta', name: 'Zeta', color: 'tag-2', order: 1 },
      { slug: 'beta', name: 'Beta', color: 'tag-1', order: 1 },
      { slug: 'first', name: 'First', color: 'tag-3', order: 0 },
    ]);
    await api.resyncCatalog();
    expect((await list()).map((tag) => tag.slug)).toEqual([
      'first',
      'beta',
      'zeta',
    ]);
  });

  it('creates, updates and deletes only for holders of judge.change_contest_tag', async () => {
    const body = {
      slug: 'olp',
      name: 'Olympiad',
      color: 'tag-4',
      description: 'Cups',
    };
    await api.http().post(url).send(body).expect(401);
    await create(body, plain).expect(403);
    await create(body).expect(201);
    expect(await list()).toEqual([{ ...body, order: 0 }]);
    await authed(api.http().patch(`${url}/olp`), plain)
      .send({ name: 'No' })
      .expect(403);
    await authed(api.http().patch(`${url}/olp`), admin)
      .send({ name: 'Olympiad 2', color: 'tag-5' })
      .expect(200);
    expect(await list()).toEqual([
      { ...body, name: 'Olympiad 2', color: 'tag-5', order: 0 },
    ]);
    await authed(api.http().delete(`${url}/olp`), plain).expect(403);
    await authed(api.http().delete(`${url}/olp`), admin).expect(204);
    expect(await list()).toEqual([]);
  });

  it('refuses a repeated slug, a colour outside the token set and a bad slug', async () => {
    await create({ slug: 'olp', name: 'A', color: 'tag-1' }).expect(201);
    await create({ slug: 'olp', name: 'B', color: 'tag-2' })
      .expect(409)
      .expect(errorCode('conflict'));
    await create({ slug: 'new', name: 'B', color: 'red' }).expect(400);
    await create({ slug: 'Bad Slug', name: 'B', color: 'tag-1' }).expect(400);
    await create({
      slug: 'long',
      name: 'x'.repeat(41),
      color: 'tag-1',
    }).expect(400);
    expect(await list()).toHaveLength(1);
  });

  it('pages the list and refuses a 101st tag', async () => {
    await api.contestTags.create([
      { slug: 'a', name: 'A', color: 'tag-1', order: 0 },
      { slug: 'b', name: 'B', color: 'tag-1', order: 1 },
      { slug: 'c', name: 'C', color: 'tag-1', order: 2 },
    ]);
    await api.resyncCatalog();
    const page = await api.http().get(`${url}?pageSize=2&page=2`).expect(200);
    expect(dataOf<ContestTagResponse[]>(page).map((tag) => tag.slug)).toEqual([
      'c',
    ]);
    expect((page.body as { meta: { total: number } }).meta.total).toBe(3);
    await api.contestTags.insertMany(
      Array.from({ length: 97 }, (_unused, index) => ({
        slug: `bulk-${index}`,
        name: 'Bulk',
        color: 'tag-2',
        order: 10 + index,
      })),
    );
    await create({ slug: 'one-too-many', name: 'X', color: 'tag-1' })
      .expect(409)
      .expect(errorCode('tag_limit'));
  });

  it('answers 404 for an unknown slug on update and delete', async () => {
    await authed(api.http().patch(`${url}/nope`), admin)
      .send({ name: 'X' })
      .expect(404);
    await authed(api.http().delete(`${url}/nope`), admin).expect(404);
  });

  it('keeps the contests that use a deleted tag (they show a neutral chip)', async () => {
    await create({ slug: 'olp', name: 'Olympiad', color: 'tag-4' }).expect(201);
    const contest = await createContest(api, { tags: ['olp'] });
    await authed(api.http().delete(`${url}/olp`), admin).expect(204);
    expect((await api.contests.findById(contest._id).lean())!.tags).toEqual([
      'olp',
    ]);
  });
});
