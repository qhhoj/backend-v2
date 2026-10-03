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
  let memberToken: string;
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
    const member = await createUserWith(api, 'member', {
      organizations: [ORG],
    });
    const memberIssued = generateApiToken(member._id, TEST_ENV.TOKEN_SECRET);
    memberToken = memberIssued.token;
    await api.users.updateOne(
      { _id: member._id },
      { apiTokenHash: memberIssued.hash },
    );
    await createProblem(api, catalog, {
      code: 'delta',
      name: 'Delta',
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
        current_object_count: 2,
        objects_per_page: 1000,
        page_index: 1,
        has_more: false,
        total_objects: 2,
        total_pages: 1,
      },
    });
    expect(body.data!.objects![0]).toEqual({
      code: 'alpha',
      name: 'Alpha',
      types: ['Dynamic Programming'],
      group: 'VOI',
      points: 1000,
      partial: true,
      is_organization_private: false,
      is_public: true,
    });
    expect(body.data!.objects!.map((item) => item.code)).toEqual([
      'alpha',
      'delta',
    ]);
    expect(
      bodyOf(
        await api
          .http()
          .get(`${V2}/problems`)
          .set('Authorization', `Bearer ${token}`)
          .expect(200),
      ).data!.objects!.map((item) => item.code),
    ).toEqual(['alpha', 'delta', 'gamma']);
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
    expect(await codes('partial=0')).toEqual(['delta', 'gamma']);
    expect(await codes('code=gamma&code=alpha')).toEqual(['alpha', 'gamma']);
    expect(await codes('group=VOI')).toEqual(['alpha']);
    expect(await codes('group=voi')).toEqual(['alpha']);
    expect(await codes('type=dynamic%20programming')).toEqual(['alpha']);
    expect(await codes('type=Dynamic%20Programming')).toEqual(['alpha']);
    expect(await codes(`organization=${ORG}`)).toEqual(['delta']);
    expect(await codes('unknown=1&_=123')).toEqual(['alpha', 'delta', 'gamma']);
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
      'code=a%00b',
      'search=%00',
      `search=${'x'.repeat(101)}`,
      'organization=nope',
      `code=${Array(101).fill('a').join('&code=')}`,
    ])
      expect(
        bodyOf(await api.http().get(`${V2}/problems?${query}`).expect(400)),
      ).toMatchObject({
        api_version: '2.0',
        error: { code: 400, message: 'invalid filter value type' },
      });
  });
  it('lists and details organization-private problems for members only', async () => {
    const asMember = (path: string) =>
      api
        .http()
        .get(`${V2}${path}`)
        .set('Authorization', `Bearer ${memberToken}`);
    const list = bodyOf(await asMember('/problems?code=beta').expect(200));
    expect(list.data!.objects).toMatchObject([
      { code: 'beta', is_organization_private: true },
    ]);
    expect(
      bodyOf(await asMember('/problem/beta').expect(200)).data!.object,
    ).toMatchObject({ is_organization_private: true, organizations: [ORG] });
  });
  it('hides leftover organizations on non-organization-private problems', async () => {
    expect(
      bodyOf(await api.http().get(`${V2}/problem/delta`).expect(200)).data!
        .object,
    ).toMatchObject({ is_organization_private: false, organizations: [] });
  });
  it('strips Mongo-operator query keys instead of applying them', async () => {
    const body = bodyOf(
      await api.http().get(`${V2}/problems?code%5B%24ne%5D=alpha`).expect(200),
    );
    expect(body.data!.objects!.map((item) => item.code)).toEqual([
      'alpha',
      'delta',
    ]);
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
          .expect(403),
      ),
    ).toMatchObject({
      api_version: '2.0',
      error: { code: 403, message: 'login required' },
    });
  });
});
