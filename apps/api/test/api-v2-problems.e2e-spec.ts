import { generateApiToken } from '@libs/auth';
import { newId } from '@libs/database';
import {
  Catalog,
  createProblem,
  createUserWith,
  seedCatalog,
} from './problem-fixtures';
import { ApiTest, setupApiTest, TEST_ENV } from './setup';

const V2 = '/api/v2';
type Envelope = {
  api_version: string;
  method: string;
  fetched: string;
  data?: {
    objects?: Array<{ code: string }>;
    object?: Record<string, unknown>;
    total_pages?: number;
    objects_per_page?: number;
  };
  error?: { code: number; message: string };
};
const bodyOf = ({ body }: { body: unknown }) => body as Envelope;

describe('/api/v2 problems', () => {
  let api: ApiTest;
  let catalog: Catalog;
  let authorId: string;
  let token: string;
  const ORG = newId();

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
    await api.problems.init();
    const author = await createUserWith(api, 'author');
    authorId = author._id;
    const issued = generateApiToken(authorId, TEST_ENV.TOKEN_SECRET);
    token = issued.token;
    await api.users.updateOne({ _id: authorId }, { apiTokenHash: issued.hash });
    await createProblem(api, catalog, {
      code: 'alpha',
      name: 'Alpha',
      partial: true,
      typeIds: [catalog.types.dp],
      groupId: catalog.groups.voi,
      authors: [authorId],
      languageLimits: [
        {
          languageId: catalog.languages.python,
          timeLimit: 2,
          memoryLimit: 65536,
        },
      ],
    });
    await createProblem(api, catalog, {
      code: 'beta',
      name: 'Beta',
      isOrganizationPrivate: true,
      organizations: [ORG],
    });
    await createProblem(api, catalog, {
      code: 'gamma',
      name: 'Gamma',
      isPublic: false,
      authors: [authorId],
    });
  });
  afterAll(() => api.teardown());

  it('lists visible problems in the legacy envelope', async () => {
    const body = bodyOf(await api.http().get(`${V2}/problems`).expect(200));
    expect(body).toMatchObject({
      api_version: '2.0',
      method: 'get',
      data: {
        current_object_count: 1,
        objects_per_page: 1000,
        page_index: 1,
        has_more: false,
        total_objects: 1,
        total_pages: 1,
      },
    });
    expect(body.data!.objects).toEqual([
      {
        code: 'alpha',
        name: 'Alpha',
        types: ['Dynamic Programming'],
        group: 'VOI',
        points: 1000,
        partial: true,
        is_organization_private: false,
        is_public: true,
      },
    ]);
    expect(
      bodyOf(
        await api
          .http()
          .get(`${V2}/problems`)
          .set('Authorization', `Bearer ${token}`)
          .expect(200),
      ).data!.objects!.map((item) => item.code),
    ).toEqual(['alpha', 'gamma']);
  });
  it('applies the legacy filters', async () => {
    const codes = async (query: string) =>
      bodyOf(
        await api
          .http()
          .get(`${V2}/problems?${query}`)
          .set('Authorization', `Bearer ${token}`)
          .expect(200),
      ).data!.objects!.map((item) => item.code);
    expect(await codes('partial=true')).toEqual(['alpha']);
    expect(await codes('partial=0')).toEqual(['gamma']);
    expect(await codes('code=gamma&code=alpha')).toEqual(['alpha', 'gamma']);
    expect(await codes('group=VOI')).toEqual(['alpha']);
    expect(await codes('type=Dynamic%20Programming')).toEqual(['alpha']);
    expect(await codes(`organization=${ORG}`)).toEqual([]);
    expect(await codes('search=gamma')).toEqual(['gamma']);
    expect(
      bodyOf(await api.http().get(`${V2}/problems?partial=maybe`).expect(400)),
    ).toMatchObject({
      api_version: '2.0',
      error: { code: 400, message: 'invalid filter value type' },
    });
    expect(
      bodyOf(await api.http().get(`${V2}/problems?page=2`).expect(404)),
    ).toMatchObject({ error: { code: 404, message: 'page/object not found' } });
    await api.http().get(`${V2}/problems?page=0`).expect(400);
  });
  it('rejects malformed filters with the legacy 400, never a 500', async () => {
    for (const query of [
      'page=10001',
      'page=abc',
      'code%5B%24ne%5D=x',
      'code=a%00b',
      'search=%00',
      `search=${'x'.repeat(101)}`,
      'organization=nope',
      'unknown=1',
      `code=${Array(101).fill('a').join('&code=')}`,
    ])
      expect(
        bodyOf(await api.http().get(`${V2}/problems?${query}`).expect(400)),
      ).toMatchObject({
        api_version: '2.0',
        error: { code: 400, message: 'invalid filter value type' },
      });
  });
  it('escapes short searches instead of passing regex syntax', async () => {
    expect(
      bodyOf(await api.http().get(`${V2}/problems?search=.*`).expect(200)).data!
        .objects,
    ).toEqual([]);
  });
  it('returns the legacy detail and 404s invisible problems', async () => {
    const body = bodyOf(
      await api.http().get(`${V2}/problem/alpha`).expect(200),
    );
    expect(body.data!.object).toEqual({
      code: 'alpha',
      name: 'Alpha',
      authors: ['author'],
      types: ['Dynamic Programming'],
      group: 'VOI',
      time_limit: 1,
      memory_limit: 262144,
      language_resource_limits: [
        { language: 'PY3', time_limit: 2, memory_limit: 65536 },
      ],
      points: 1000,
      partial: true,
      short_circuit: false,
      languages: ['CPP17', 'PY3'],
      is_organization_private: false,
      organizations: [],
      is_public: true,
    });
    expect(
      bodyOf(
        await api
          .http()
          .get(`${V2}/problem/beta`)
          .set('Authorization', `Bearer ${token}`)
          .expect(404),
      ),
    ).toMatchObject({ error: { code: 404, message: 'page/object not found' } });
    expect(
      bodyOf(
        await api
          .http()
          .get(`${V2}/problem/gamma`)
          .set('Authorization', `Bearer ${token}`)
          .expect(200),
      ).data!.object,
    ).toMatchObject({ is_public: false, organizations: [] });
    await api.http().get(`${V2}/problem/gamma`).expect(404);
    expect(
      bodyOf(
        await api
          .http()
          .get(`${V2}/problem/alpha`)
          .set('Authorization', 'Bearer nope')
          .expect(401),
      ),
    ).toMatchObject({
      api_version: '2.0',
      error: { code: 401, message: 'login required' },
    });
  });
});
