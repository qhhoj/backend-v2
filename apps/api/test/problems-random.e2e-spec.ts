import { newId } from '@libs/database';
import {
  authed,
  Catalog,
  createProblem,
  createUserWith,
  loginAs,
  seedCatalog,
  TestSession,
} from './problem-fixtures';
import { ApiTest, errorCode, setupApiTest } from './setup';

const RANDOM = '/api/internal/problems/random';
const codeOf = ({ body }: { body: unknown }) =>
  (body as { data: { code: string } }).data.code;

describe('GET /api/internal/problems/random', () => {
  let api: ApiTest;
  let catalog: Catalog;
  let author: TestSession;
  const ORG = newId();

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
    const authorUser = await createUserWith(api, 'author', {
      permissions: ['judge.edit_own_problem'],
    });
    author = await loginAs(api, authorUser._id);
    await createProblem(api, catalog, { code: 'easy', points: 900 });
    await createProblem(api, catalog, { code: 'easy2', points: 1000 });
    await createProblem(api, catalog, { code: 'hard', points: 3000 });
    await createProblem(api, catalog, {
      code: 'secret',
      isPublic: false,
      authors: [authorUser._id],
      points: 3000,
    });
    await createProblem(api, catalog, {
      code: 'orgonly',
      isOrganizationPrivate: true,
      organizations: [ORG],
      points: 3000,
    });
  });
  afterAll(() => api.teardown());

  it('only returns problems matching the list filters', async () => {
    const seen = new Set<string>();
    for (let attempt = 0; attempt < 30; attempt++)
      seen.add(codeOf(await api.http().get(`${RANDOM}?pointsMax=1000`)));
    expect([...seen].sort()).toEqual(['easy', 'easy2']);
    expect(codeOf(await api.http().get(`${RANDOM}?pointsMin=2000`))).toBe(
      'hard',
    );
  });

  it('never returns what the list would hide from the viewer', async () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      expect(
        codeOf(await api.http().get(`${RANDOM}?pointsMin=2000&visibility=all`)),
      ).toBe('hard');
    }
    expect(
      codeOf(
        await authed(
          api.http().get(`${RANDOM}?q=secret&visibility=all`),
          author,
        ),
      ),
    ).toBe('secret');
  });

  it('answers 404 no_problem when nothing matches', async () => {
    await api
      .http()
      .get(`${RANDOM}?pointsMin=9000`)
      .expect(404)
      .expect(errorCode('no_problem'));
    await api
      .http()
      .get(`${RANDOM}?q=secret&visibility=all`)
      .expect(404)
      .expect(errorCode('no_problem'));
  });

  it('rejects invalid filters like the list', async () => {
    await api.http().get(`${RANDOM}?groupId=nope`).expect(400);
  });
});
