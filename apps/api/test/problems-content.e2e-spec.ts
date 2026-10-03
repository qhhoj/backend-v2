import { ProblemEvents } from '../src/modules/problems/problem.events';
import {
  authed,
  createProblem,
  createUserWith,
  detailOf,
  loginAs,
  seedCatalog,
} from './problem-fixtures';
import type { Catalog, TestSession } from './problem-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';

const PROBLEMS = '/api/internal/problems';

describe('translations, editorial, clone and preview', () => {
  let api: ApiTest;
  let catalog: Catalog;
  let editorId: string;
  let editor: TestSession,
    cloner: TestSession,
    plain: TestSession,
    fullMarkup: TestSession;
  const statementChanges: string[] = [];

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
    await api.problems.init();
    editorId = (
      await createUserWith(api, 'editor', {
        permissions: ['judge.edit_own_problem'],
      })
    )._id;
    const clonerUser = await createUserWith(api, 'cloner', {
      permissions: ['judge.edit_own_problem', 'judge.clone_problem'],
    });
    const plainUser = await createUserWith(api, 'plain');
    const fullUser = await createUserWith(api, 'full', {
      permissions: ['judge.edit_own_problem', 'judge.problem_full_markup'],
    });
    editor = await loginAs(api, editorId);
    cloner = await loginAs(api, clonerUser._id);
    plain = await loginAs(api, plainUser._id);
    fullMarkup = await loginAs(api, fullUser._id);
    await createProblem(api, catalog, {
      code: 'src',
      description: 'Base $x$',
      descriptionHtml: '<p>Base</p>',
      authors: [editorId],
      curators: [clonerUser._id],
      testers: [plainUser._id],
      languageLimits: [
        {
          languageId: catalog.languages.python,
          timeLimit: 3,
          memoryLimit: 1024,
        },
      ],
      licenseId: catalog.licenses.mit,
      pdfStatementUrl: '/media/pdf/x.pdf',
      translations: [
        {
          language: 'vi',
          name: 'Cũ',
          description: 'cũ',
          descriptionHtml: '<p>cũ</p>',
        },
      ],
      solution: {
        isPublic: true,
        publishOn: new Date(0),
        authors: [],
        content: 's',
        contentHtml: '<p>s</p>',
      },
      userCount: 7,
      acRate: 50,
    });
    await createProblem(api, catalog, {
      code: 'markup',
      isFullMarkup: true,
      description: 'raw',
      authors: [editorId, fullUser._id],
    });
    api.app
      .get(ProblemEvents)
      .on('statementChanged', (problemId) => statementChanges.push(problemId));
  });
  afterAll(() => api.teardown());

  it('upserts a translation, renders it and emits statementChanged', async () => {
    await authed(api.http().put(`${PROBLEMS}/src/translations/vi`), editor)
      .send({ name: 'Mới', description: 'Nội dung $y$' })
      .expect(204);
    await authed(api.http().put(`${PROBLEMS}/src/translations/vi`), editor)
      .send({ name: 'Mới hơn', description: 'Nội dung $y$' })
      .expect(204);
    await authed(api.http().put(`${PROBLEMS}/src/translations/vi`), editor)
      .send({ name: 'Mới hơn', description: 'Nội dung $y$' })
      .expect(204);
    const stored = (await api.problems.findOne({ code: 'src' }))!;
    expect(stored.translations).toHaveLength(1);
    expect(stored.translations[0]).toMatchObject({
      language: 'vi',
      name: 'Mới hơn',
    });
    expect(stored.translations[0].descriptionHtml).toContain('katex');
    expect(statementChanges).toEqual([stored._id, stored._id]);
    expect(
      detailOf(await api.http().get(`${PROBLEMS}/src?lang=vi`).expect(200))
        .name,
    ).toBe('Mới hơn');
    await authed(api.http().put(`${PROBLEMS}/src/translations/fr`), editor)
      .send({ name: 'x', description: 'y' })
      .expect(400)
      .expect(errorCode('validation_failed'));
    await authed(api.http().put(`${PROBLEMS}/src/translations/vi`), plain)
      .send({ name: 'x', description: 'y' })
      .expect(403);
    await authed(api.http().put(`${PROBLEMS}/nope/translations/vi`), editor)
      .send({ name: 'x', description: 'y' })
      .expect(404);
    expect(await api.revisions.countDocuments({ action: 'translation' })).toBe(
      2,
    );
    const revision = (await api.revisions.findOne({ action: 'translation' }))!;
    expect(JSON.stringify(revision.changes)).not.toContain('descriptionHtml');
  });

  it('gates translation descriptions of a full-markup problem', async () => {
    await authed(api.http().put(`${PROBLEMS}/markup/translations/vi`), editor)
      .send({ name: 'x', description: '<b>y</b>' })
      .expect(403);
    await authed(
      api.http().put(`${PROBLEMS}/markup/translations/vi`),
      fullMarkup,
    )
      .send({ name: 'x', description: '<b>y</b>' })
      .expect(204);
    expect(
      (await api.problems.findOne({ code: 'markup' }))!.translations[0]
        .descriptionHtml,
    ).toContain('<b>y</b>');
    await authed(api.http().put(`${PROBLEMS}/markup/translations/vi`), editor)
      .send({ name: 'renamed', description: '<b>y</b>' })
      .expect(204);
    await authed(api.http().put(`${PROBLEMS}/markup/translations/vi`), editor)
      .send({ name: 'renamed', description: '<b>y</b>' })
      .expect(204);
    expect(
      (await api.problems.findOne({ code: 'markup' }))!.translations[0].name,
    ).toBe('renamed');
  });

  it('replaces the editorial, validates authors and keeps it sanitized', async () => {
    const body = {
      isPublic: false,
      publishOn: '2026-01-01T00:00:00Z',
      authors: [editorId],
      content: 'Use <script>1</script> math $x$',
    };
    await authed(api.http().put(`${PROBLEMS}/src/editorial`), editor)
      .send(body)
      .expect(204);
    await authed(api.http().put(`${PROBLEMS}/src/editorial`), editor)
      .send(body)
      .expect(204);
    const stored = (await api.problems.findOne({ code: 'src' }))!;
    expect(stored.solution).toMatchObject({
      isPublic: false,
      publishOn: new Date('2026-01-01T00:00:00Z'),
    });
    expect(stored.solution!.contentHtml).toContain('katex');
    expect(stored.solution!.contentHtml).not.toContain('<script>');
    expect(await api.revisions.countDocuments({ action: 'editorial' })).toBe(1);
    await api.http().get(`${PROBLEMS}/src/editorial`).expect(404);
    await authed(api.http().get(`${PROBLEMS}/src/editorial`), editor).expect(
      200,
    );
    for (const publishOn of [
      'soon',
      '2026-W01',
      '2026-001',
      '2026-02-30T00:00:00Z',
      '2026-01-01T00:00:00',
    ])
      await authed(api.http().put(`${PROBLEMS}/src/editorial`), editor)
        .send({ ...body, publishOn })
        .expect(400);
    await authed(api.http().put(`${PROBLEMS}/src/editorial`), editor)
      .send({ ...body, publishOn: '2026-03-01T07:00:00+07:00' })
      .expect(204);
    expect(
      (await api.problems.findOne({ code: 'src' }))!.solution!.publishOn,
    ).toEqual(new Date('2026-03-01T00:00:00Z'));
    await authed(api.http().put(`${PROBLEMS}/src/editorial`), editor)
      .send({ ...body, authors: ['00000000-0000-7000-8000-000000000000'] })
      .expect(400)
      .expect(errorCode('validation_failed'));
    await authed(api.http().put(`${PROBLEMS}/src/editorial`), plain)
      .send(body)
      .expect(403);
  });

  it('clones with the legacy copy rules', async () => {
    await authed(api.http().post(`${PROBLEMS}/src/clone`), editor)
      .send({ code: 'copy' })
      .expect(403)
      .expect(errorCode('forbidden'));
    const detail = detailOf(
      await authed(api.http().post(`${PROBLEMS}/src/clone`), cloner)
        .send({ code: 'copy' })
        .expect(201),
    );
    expect(detail).toMatchObject({
      code: 'copy',
      isPublic: false,
      userCount: 0,
      acRate: 0,
      license: { key: 'mit' },
      languageLimits: [{ language: 'PY3', timeLimit: 3 }],
      pdfStatementUrl: '/media/pdf/x.pdf',
      authors: [],
      availableTranslations: [],
      hasEditorial: false,
    });
    const stored = (await api.problems.findOne({ code: 'copy' }))!.toJSON();
    expect(stored).toMatchObject({
      curators: [(await api.users.findOne({ username: 'cloner' }))!._id],
      testers: [],
      bannedUsers: [],
      translations: [],
      solution: null,
      description: 'Base $x$',
    });
    expect(stored.allowedLanguages).toEqual([
      catalog.languages.cpp,
      catalog.languages.python,
    ]);
    expect(
      (await api.problems.findOne({ code: 'src' }))!.languageLimits,
    ).toHaveLength(1);
    expect(await api.revisions.findOne({ action: 'clone' })).toMatchObject({
      comment: 'Cloned problem from src',
    });
    await authed(api.http().post(`${PROBLEMS}/src/clone`), cloner)
      .send({ code: 'copy' })
      .expect(400)
      .expect(errorCode('validation_failed'));
    await authed(api.http().post(`${PROBLEMS}/nope/clone`), cloner)
      .send({ code: 'copy2' })
      .expect(404);
  });

  it('previews markdown per style with permission and rate limit', async () => {
    const raw = '# T <script>1</script>';
    const preview = (session: TestSession, style: string, markdown = raw) =>
      authed(api.http().post(`${PROBLEMS}/render-preview`), session).send({
        style,
        markdown,
      });
    expect((await preview(editor, 'problem').expect(201)).body).toEqual({
      data: { html: '<h3>T </h3>\n' },
    });
    await preview(editor, 'problem-full').expect(403);
    expect(
      (await preview(fullMarkup, 'problem-full').expect(201)).body,
    ).toEqual({ data: { html: '<h3>T <script>1</script></h3>\n' } });
    await preview(plain, 'problem').expect(403);
    for (let attempt = 0; attempt < 59; attempt++)
      await preview(editor, 'problem', 'x').expect(201);
    await preview(editor, 'problem', 'x')
      .expect(429)
      .expect(errorCode('rate_limited'));
  });
});
