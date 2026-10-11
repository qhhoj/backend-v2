import {
  authed,
  createProblem,
  createUserWith,
  loginAs,
  seedCatalog,
} from './problem-fixtures';
import type { Catalog, TestSession } from './problem-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';

let api: ApiTest;

beforeAll(async () => {
  api = await setupApiTest();
});
afterAll(() => api.teardown());

const PROBLEMS = '/api/internal/problems';
const dataOf = <Data>({ body }: { body: unknown }) =>
  (body as { data: Data }).data;

describe('bulk visibility and change messages', () => {
  let catalog: Catalog;
  let publisherId: string;
  let publisher: TestSession;
  let plain: TestSession;

  beforeAll(async () => {
    await api.reset();
    catalog = await seedCatalog(api);
    publisherId = (
      await createUserWith(api, 'publisher', {
        permissions: [
          'judge.edit_own_problem',
          'judge.change_public_visibility',
        ],
      })
    )._id;
    publisher = await loginAs(api, publisherId);
    plain = await loginAs(api, (await createUserWith(api, 'plain'))._id);
    const old = new Date('2020-01-01T00:00:00Z');
    await createProblem(api, catalog, {
      code: 'mine',
      isPublic: false,
      date: old,
      curators: [publisherId],
    });
    await createProblem(api, catalog, { code: 'theirs', isPublic: false });
    await createProblem(api, catalog, {
      code: 'shown',
      isPublic: true,
      curators: [publisherId],
    });
  });

  const bulk = (session: TestSession, body: Record<string, unknown>) =>
    authed(api.http().post(`${PROBLEMS}/bulk/visibility`), session).send(body);

  it('publishes editable problems, reports the rest per code, and keeps going', async () => {
    const result = dataOf<{
      results: unknown[];
      done: number;
      failed: number;
    }>(
      await bulk(publisher, {
        codes: ['theirs', 'mine', 'shown', 'ghost'],
        isPublic: true,
        changeMessage: 'Round 12 is over',
      }).expect(200),
    );
    expect(result).toEqual({
      results: [
        { code: 'theirs', outcome: 'failed', reason: 'not_found' },
        { code: 'mine', outcome: 'done' },
        { code: 'shown', outcome: 'unchanged' },
        { code: 'ghost', outcome: 'failed', reason: 'not_found' },
      ],
      done: 1,
      failed: 2,
    });
    const mine = (await api.problems.findOne({ code: 'mine' }))!;
    expect(mine.isPublic).toBe(true);
    expect(mine.date?.toISOString()).toBe('2020-01-01T00:00:00.000Z');
    expect((mine.toJSON() as Record<string, unknown>).changeMessage).toBe(
      undefined,
    );
    const revisions = await api.revisions.find({ entityId: mine._id });
    expect(revisions.map((revision) => revision.comment)).toEqual([
      'Round 12 is over',
    ]);
  });

  it('refuses setting the date without judge.edit_all_problem, per problem', async () => {
    const { results } = dataOf<{ results: unknown[] }>(
      await bulk(publisher, {
        codes: ['mine'],
        isPublic: false,
        setDateToNow: true,
      }).expect(200),
    );
    expect(results).toEqual([{ code: 'mine', outcome: 'done' }]);
    const { results: dated } = dataOf<{ results: unknown[] }>(
      await bulk(publisher, {
        codes: ['mine'],
        isPublic: true,
        setDateToNow: true,
      }).expect(200),
    );
    expect(dated).toEqual([
      { code: 'mine', outcome: 'failed', reason: 'forbidden' },
    ]);
  });

  it('needs judge.change_public_visibility', async () => {
    await bulk(plain, { codes: ['mine'], isPublic: true })
      .expect(403)
      .expect(errorCode('forbidden'));
  });

  it('keeps a PATCH changeMessage as the revision comment only', async () => {
    const problem = (await api.problems.findOne({ code: 'shown' }))!;
    await authed(api.http().patch(`${PROBLEMS}/shown`), publisher)
      .send({ source: 'VOI 2024', changeMessage: '  Fix the credit  ' })
      .expect(200);
    const [revision] = await api.revisions.find({ entityId: problem._id });
    expect(revision.comment).toBe('Fix the credit');
    const stored = (await api.problems.findOne({ code: 'shown' }))!.toJSON();
    expect(stored).not.toHaveProperty('changeMessage');
  });
});

describe('admin problem list filters', () => {
  let catalog: Catalog;
  let authorId: string;
  let editAll: TestSession;
  let anonymousList: (query: string) => Promise<string[]>;

  beforeAll(async () => {
    await api.reset();
    catalog = await seedCatalog(api);
    authorId = (await createUserWith(api, 'author'))._id;
    const suggesterId = (await createUserWith(api, 'suggester'))._id;
    editAll = await loginAs(
      api,
      (await createUserWith(api, 'staff', { isSuperuser: true }))._id,
    );
    await createProblem(api, catalog, { code: 'wrote', authors: [authorId] });
    await createProblem(api, catalog, {
      code: 'curated',
      curators: [authorId],
    });
    await createProblem(api, catalog, {
      code: 'pending',
      isPublic: false,
      suggester: suggesterId,
    });
    anonymousList = async (query) =>
      codesOf(await api.http().get(`${PROBLEMS}?${query}`).expect(200));
  });

  const codesOf = ({ body }: { body: unknown }) =>
    (body as { data: { code: string }[] }).data.map((item) => item.code).sort();

  it('matches curators only for full editors', async () => {
    expect(await anonymousList(`authorId=${authorId}`)).toEqual(['wrote']);
    const staff = await authed(
      api.http().get(`${PROBLEMS}?authorId=${authorId}&visibility=all`),
      editAll,
    ).expect(200);
    expect(codesOf(staff)).toEqual(['curated', 'wrote']);
  });

  it('lists pending suggestions apart, with authors on each item', async () => {
    const pending = await authed(
      api.http().get(`${PROBLEMS}?suggested=true&visibility=all`),
      editAll,
    ).expect(200);
    expect(codesOf(pending)).toEqual(['pending']);
    const page = dataOf<{ code: string; authors: { username: string }[] }[]>(
      await api.http().get(`${PROBLEMS}?suggested=false`).expect(200),
    );
    expect(page.find((item) => item.code === 'wrote')?.authors).toEqual([
      expect.objectContaining({ id: authorId, username: 'author' }),
    ]);
  });
});

describe('problem catalogs admin', () => {
  let staff: TestSession;
  let typist: TestSession;

  beforeAll(async () => {
    await api.reset();
    await seedCatalog(api);
    staff = await loginAs(
      api,
      (await createUserWith(api, 'staff', { isSuperuser: true }))._id,
    );
    typist = await loginAs(
      api,
      (
        await createUserWith(api, 'typist', {
          permissions: ['judge.change_problemtype'],
        })
      )._id,
    );
  });

  const ADMIN = '/api/internal/admin';
  const metaTypes = async () =>
    dataOf<{ types: { name: string }[] }>(
      await api.http().get(`${PROBLEMS}/meta`).expect(200),
    ).types.map((type) => type.name);

  it('creates a type that the meta catalog serves at once, and logs it', async () => {
    const created = dataOf<{ id: string }>(
      await authed(api.http().post(`${ADMIN}/problem-types`), staff)
        .send({ name: 'graph', fullName: 'Graph theory' })
        .expect(201),
    );
    expect(await metaTypes()).toContain('graph');
    const [revision] = await api.revisions.find({ entityId: created.id });
    expect(revision).toMatchObject({ entity: 'problemType', action: 'create' });
  });

  it('refuses a name taken in another case with 409 conflict', async () => {
    await authed(api.http().post(`${ADMIN}/problem-types`), staff)
      .send({ name: 'DP', fullName: 'Again' })
      .expect(409)
      .expect(errorCode('conflict'));
  });

  it('lets judge.change_problemtype edit but not add', async () => {
    const [type] = dataOf<{ id: string; name: string }[]>(
      await authed(api.http().get(`${ADMIN}/problem-types`), typist).expect(
        200,
      ),
    ).filter((item) => item.name === 'graph');
    await authed(api.http().patch(`${ADMIN}/problem-types/${type.id}`), typist)
      .send({ fullName: 'Graphs' })
      .expect(200);
    await authed(api.http().post(`${ADMIN}/problem-types`), typist)
      .send({ name: 'math', fullName: 'Math' })
      .expect(403);
    await authed(api.http().get(`${ADMIN}/licenses`), typist).expect(403);
  });
});
