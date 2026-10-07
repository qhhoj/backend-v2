import { newId } from '@libs/database';
import { ProblemListItemResponse } from '../src/modules/problems/core/dto/problem-list.response';
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

const LIST = '/api/internal/problems';
type ListBody = {
  data: ProblemListItemResponse[];
  meta: { page: number; pageSize: number; total: number };
};
const codesOf = ({ body }: { body: unknown }) =>
  (body as ListBody).data.map((item) => item.code);

describe('GET /api/internal/problems', () => {
  let api: ApiTest;
  let catalog: Catalog;
  let authorUser: Awaited<ReturnType<typeof createUserWith>>;
  let author: TestSession, orgMember: TestSession, plain: TestSession;
  const ORG = newId();
  const day = (offset: number) => new Date(Date.UTC(2026, 0, 1 + offset));

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
    await api.problems.init();
    authorUser = await createUserWith(api, 'author', {
      permissions: ['judge.edit_own_problem'],
    });
    const member = await createUserWith(api, 'member', {
      organizations: [ORG],
    });
    const plainUser = await createUserWith(api, 'plain');
    author = await loginAs(api, authorUser._id);
    orgMember = await loginAs(api, member._id);
    plain = await loginAs(api, plainUser._id);
    await createProblem(api, catalog, {
      code: 'apple',
      name: 'Apple',
      points: 900,
      date: day(1),
      typeIds: [catalog.types.dp],
      groupId: catalog.groups.voi,
      source: 'VOI 2019',
    });
    await createProblem(api, catalog, {
      code: 'banana',
      name: 'banana',
      points: 1500,
      date: day(2),
      translations: [
        {
          language: 'vi',
          name: 'Quả chuối',
          description: '',
          descriptionHtml: '',
        },
      ],
      solution: {
        isPublic: true,
        publishOn: day(0),
        authors: [],
        content: '',
        contentHtml: '',
      },
    });
    await createProblem(api, catalog, {
      code: 'cherry',
      name: 'Cherry',
      points: 2500,
      date: day(3),
      solution: {
        isPublic: false,
        publishOn: day(0),
        authors: [],
        content: '',
        contentHtml: '',
      },
    });
    await createProblem(api, catalog, {
      code: 'secret',
      isPublic: false,
      authors: [authorUser._id],
      date: day(4),
    });
    await createProblem(api, catalog, {
      code: 'orgonly',
      isOrganizationPrivate: true,
      organizations: [ORG],
      date: day(5),
    });
    await createProblem(api, catalog, {
      code: 'cpp_tricks',
      name: 'C++ tricks',
      date: day(6),
    });
  });
  afterAll(() => api.teardown());

  it('lists public non-organization problems newest first with pagination meta', async () => {
    const response = await api.http().get(LIST).expect(200);
    expect(codesOf(response)).toEqual([
      'cpp_tricks',
      'cherry',
      'banana',
      'apple',
    ]);
    expect((response.body as ListBody).meta).toEqual({
      page: 1,
      pageSize: 50,
      total: 4,
    });
    expect((response.body as ListBody).data[2]).toMatchObject({
      code: 'banana',
      hasPublicEditorial: true,
      hasPdfStatement: false,
      group: { fullName: 'Uncategorized' },
      types: [{ name: 'uncategorized' }],
    });
    expect(
      codesOf(await api.http().get(`${LIST}?page=2&pageSize=3`).expect(200)),
    ).toEqual(['apple']);
    await api
      .http()
      .get(`${LIST}?pageSize=101`)
      .expect(400)
      .expect(errorCode('validation_failed'));
    await api.http().get(`${LIST}?sort=sideways`).expect(400);
    await api.http().get(`${LIST}?page=10001`).expect(400);
  });
  it('filters by group, types, points and editorial', async () => {
    expect(
      codesOf(await api.http().get(`${LIST}?groupId=${catalog.groups.voi}`)),
    ).toEqual(['apple']);
    expect(
      codesOf(
        await api
          .http()
          .get(
            `${LIST}?typeIds=${catalog.types.dp}&typeIds=${catalog.types.uncategorized}`,
          ),
      ),
    ).toHaveLength(4);
    expect(
      codesOf(await api.http().get(`${LIST}?typeIds=${catalog.types.dp}`)),
    ).toEqual(['apple']);
    expect(
      codesOf(await api.http().get(`${LIST}?pointsMin=1000&pointsMax=2000`)),
    ).toEqual(['cpp_tricks', 'banana']);
    expect(codesOf(await api.http().get(`${LIST}?hasEditorial=true`))).toEqual([
      'banana',
    ]);
    expect(codesOf(await api.http().get(`${LIST}?hasEditorial=false`))).toEqual(
      ['cpp_tricks', 'cherry', 'apple'],
    );
  });
  it('sorts by code, points and name case-insensitively', async () => {
    expect(codesOf(await api.http().get(`${LIST}?sort=code`))).toEqual([
      'apple',
      'banana',
      'cherry',
      'cpp_tricks',
    ]);
    expect(codesOf(await api.http().get(`${LIST}?sort=-points`))).toEqual([
      'cherry',
      'banana',
      'cpp_tricks',
      'apple',
    ]);
    expect(codesOf(await api.http().get(`${LIST}?sort=name`))).toEqual([
      'apple',
      'banana',
      'cpp_tricks',
      'cherry',
    ]);
  });
  it('searches the text index and translated names, and prefix-matches short queries', async () => {
    expect(codesOf(await api.http().get(`${LIST}?search=chuối`))).toEqual([
      'banana',
    ]);
    expect(codesOf(await api.http().get(`${LIST}?search=VOI`))).toEqual([
      'apple',
    ]);
    expect(codesOf(await api.http().get(`${LIST}?search=ch`))).toEqual([
      'cherry',
    ]);
    expect(codesOf(await api.http().get(`${LIST}?search=Qu`))).toEqual([
      'banana',
    ]);
  });
  it('escapes regex metacharacters in short queries and accepts "C++"', async () => {
    expect(
      codesOf(
        await api
          .http()
          .get(`${LIST}?search=${encodeURIComponent('c+')}`)
          .expect(200),
      ),
    ).toEqual(['cpp_tricks']);
    expect(
      codesOf(
        await api
          .http()
          .get(`${LIST}?search=${encodeURIComponent('a(')}`)
          .expect(200),
      ),
    ).toEqual([]);
    await api
      .http()
      .get(`${LIST}?search=${encodeURIComponent('C++')}`)
      .expect(200);
  });
  it('rejects NUL bytes in search', async () => {
    await api
      .http()
      .get(`${LIST}?search=a%00`)
      .expect(400)
      .expect(errorCode('validation_failed'));
  });
  it('treats 2FA-pending and pwned-password sessions as anonymous', async () => {
    for (const flags of [{ twoFaPassed: false }, { passwordPwned: true }]) {
      const session = await loginAs(api, authorUser._id, flags);
      expect(
        codesOf(
          await authed(api.http().get(`${LIST}?visibility=private`), session),
        ),
      ).toEqual([]);
    }
  });
  it('translates names for ?lang=vi with base fallback', async () => {
    const names = (
      (await api.http().get(`${LIST}?lang=vi&sort=code`).expect(200))
        .body as ListBody
    ).data.map((item) => item.name);
    expect(names).toEqual(['Apple', 'Quả chuối', 'Cherry', 'C++ tricks']);
  });
  it('never leaks private or organization problems to the wrong viewer', async () => {
    expect(
      codesOf(await api.http().get(`${LIST}?visibility=all`)),
    ).not.toContain('secret');
    expect(codesOf(await api.http().get(`${LIST}?visibility=private`))).toEqual(
      [],
    );
    expect(
      codesOf(
        await authed(api.http().get(`${LIST}?visibility=private`), plain),
      ),
    ).toEqual([]);
    expect(
      codesOf(
        await authed(api.http().get(`${LIST}?visibility=private`), author),
      ),
    ).toEqual(['secret']);
    expect(
      codesOf(await authed(api.http().get(`${LIST}?visibility=all`), author)),
    ).toContain('secret');
    expect(codesOf(await api.http().get(LIST))).not.toContain('orgonly');
    expect(codesOf(await authed(api.http().get(LIST), orgMember))).toContain(
      'orgonly',
    );
  });
});
