import {
  authed,
  Catalog,
  createProblem,
  createUserWith,
  detailOf,
  editorialOf,
  loginAs,
  seedCatalog,
  TestSession,
} from './problem-fixtures';
import { ApiTest, errorCode, setupApiTest } from './setup';

const PROBLEMS = '/api/internal/problems';

describe('problem detail and editorial', () => {
  let api: ApiTest;
  let catalog: Catalog;
  let authorId: string;
  let author: TestSession,
    pendingAuthor: TestSession,
    tester: TestSession,
    plain: TestSession,
    solutionReader: TestSession;
  const past = new Date('2026-01-01T00:00:00Z');
  const future = new Date('2099-01-01T00:00:00Z');
  const solutionOf = (
    isPublic: boolean,
    publishOn: Date,
    authors: string[] = [],
  ) => ({
    isPublic,
    publishOn,
    authors,
    content: 'x',
    contentHtml: '<p>x</p>',
  });

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
    const authorUser = await createUserWith(api, 'author', {
      permissions: ['judge.edit_own_problem'],
    });
    authorId = authorUser._id;
    const testerUser = await createUserWith(api, 'tester');
    const plainUser = await createUserWith(api, 'plain');
    const reader = await createUserWith(api, 'reader', {
      permissions: ['judge.see_private_solution'],
    });
    author = await loginAs(api, authorId);
    pendingAuthor = await loginAs(api, authorId, { twoFaPassed: false });
    tester = await loginAs(api, testerUser._id);
    plain = await loginAs(api, plainUser._id);
    solutionReader = await loginAs(api, reader._id);
    await createProblem(api, catalog, {
      code: 'sum',
      name: 'Sum',
      source: 'VOI',
      description: 'Add $a+b$.',
      descriptionHtml: '<p>Add <span class="katex">…</span>.</p>',
      authors: [authorId],
      licenseId: catalog.licenses.mit,
      languageLimits: [
        {
          languageId: catalog.languages.python,
          timeLimit: 3,
          memoryLimit: 262144,
        },
      ],
      translations: [
        {
          language: 'vi',
          name: 'Tổng',
          description: 'Cộng $a+b$.',
          descriptionHtml: '<p>Cộng …</p>',
        },
      ],
      solution: {
        ...solutionOf(true, past, [authorId]),
        content: 'Just add.',
        contentHtml: '<p>Just add.</p>',
      },
    });
    await createProblem(api, catalog, {
      code: 'hidden',
      isPublic: false,
      authors: [authorId],
      testers: [testerUser._id],
      solution: solutionOf(false, past),
    });
    await createProblem(api, catalog, {
      code: 'later',
      solution: solutionOf(true, future),
    });
    await createProblem(api, catalog, { code: 'noeditorial' });
  });
  afterAll(() => api.teardown());

  it('returns the rendered statement, catalog data, limits and authors to anonymous viewers', async () => {
    const detail = detailOf(
      await api.http().get(`${PROBLEMS}/sum`).expect(200),
    );
    expect(detail).toMatchObject({
      code: 'sum',
      name: 'Sum',
      language: 'en',
      translated: false,
      descriptionHtml: '<p>Add <span class="katex">…</span>.</p>',
      source: 'VOI',
      timeLimit: 1,
      memoryLimit: 262144,
      points: 1000,
      group: { fullName: 'Uncategorized' },
      types: [{ name: 'uncategorized' }],
      license: { key: 'mit' },
      authors: [{ id: authorId, username: 'author' }],
      languageLimits: [{ language: 'PY3', timeLimit: 3, memoryLimit: 262144 }],
      availableTranslations: ['vi'],
      hasEditorial: true,
      canEdit: false,
      editor: null,
    });
    expect(detail.allowedLanguages.map((language) => language.key)).toEqual([
      'CPP17',
      'PY3',
    ]);
    expect(detail).not.toHaveProperty('description');
  });

  it('serves a translation with base fallback', async () => {
    expect(
      detailOf(await api.http().get(`${PROBLEMS}/sum?lang=vi`).expect(200)),
    ).toMatchObject({
      name: 'Tổng',
      language: 'vi',
      translated: true,
      descriptionHtml: '<p>Cộng …</p>',
    });
    expect(
      detailOf(
        await api.http().get(`${PROBLEMS}/noeditorial?lang=vi`).expect(200),
      ),
    ).toMatchObject({ name: 'NOEDITORIAL', language: 'en', translated: false });
    await api
      .http()
      .get(`${PROBLEMS}/sum?lang=fr`)
      .expect(400)
      .expect(errorCode('validation_failed'));
  });

  it('answers 404 for unknown, malformed and invisible codes without leaking existence', async () => {
    await api
      .http()
      .get(`${PROBLEMS}/nope`)
      .expect(404)
      .expect(errorCode('not_found'));
    await api
      .http()
      .get(`${PROBLEMS}/Bad-Code`)
      .expect(404)
      .expect(errorCode('not_found'));
    await api.http().get(`${PROBLEMS}/Bad-Code/editorial`).expect(404);
    await api
      .http()
      .get(`${PROBLEMS}/hidden`)
      .expect(404)
      .expect(errorCode('not_found'));
    await authed(api.http().get(`${PROBLEMS}/hidden`), plain).expect(404);
    await authed(api.http().get(`${PROBLEMS}/hidden`), pendingAuthor).expect(
      404,
    );
    expect(
      detailOf(
        await authed(api.http().get(`${PROBLEMS}/hidden`), tester).expect(200),
      ),
    ).toMatchObject({ canEdit: false, editor: null });
  });

  it('exposes the editor block to editors only', async () => {
    const detail = detailOf(
      await authed(api.http().get(`${PROBLEMS}/sum`), author).expect(200),
    );
    expect(detail.canEdit).toBe(true);
    expect(detail.editor).toMatchObject({
      description: 'Add $a+b$.',
      translations: [
        { language: 'vi', name: 'Tổng', description: 'Cộng $a+b$.' },
      ],
      solution: { isPublic: true, content: 'Just add.', authors: [authorId] },
      curators: [],
      testers: [],
      suggester: null,
      licenseId: catalog.licenses.mit,
    });
  });

  it('gates the editorial on publication, permission and editorship', async () => {
    expect(
      editorialOf(
        await api.http().get(`${PROBLEMS}/sum/editorial?lang=vi`).expect(200),
      ),
    ).toMatchObject({
      problem: { code: 'sum', name: 'Tổng' },
      contentHtml: '<p>Just add.</p>',
      authors: [{ username: 'author' }],
      canEdit: false,
    });
    await api
      .http()
      .get(`${PROBLEMS}/noeditorial/editorial`)
      .expect(404)
      .expect(errorCode('not_found'));
    await api.http().get(`${PROBLEMS}/later/editorial`).expect(404);
    await authed(
      api.http().get(`${PROBLEMS}/later/editorial`),
      solutionReader,
    ).expect(200);
    await api.http().get(`${PROBLEMS}/hidden/editorial`).expect(404);
    await authed(api.http().get(`${PROBLEMS}/hidden/editorial`), tester).expect(
      404,
    );
    expect(
      editorialOf(
        await authed(
          api.http().get(`${PROBLEMS}/hidden/editorial`),
          author,
        ).expect(200),
      ).canEdit,
    ).toBe(true);
    expect(
      detailOf(await api.http().get(`${PROBLEMS}/later`).expect(200))
        .hasEditorial,
    ).toBe(false);
  });
});
