import {
  contestProblem,
  createContest,
  joinParticipation,
  makeCurrent,
} from './contest-fixtures';
import { seedSubmission } from './submission-fixtures';
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
      name: 'Tổng',
      source: 'VOI',
      description: 'Cộng $a+b$.',
      descriptionHtml: '<p>Cộng <span class="katex">…</span>.</p>',
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
          language: 'en',
          name: 'Sum',
          description: 'Add $a+b$.',
          descriptionHtml: '<p>Add …</p>',
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
    await createProblem(api, catalog, {
      code: 'secret',
      isPublic: false,
      solution: solutionOf(true, past),
    });
  });
  afterAll(() => api.teardown());

  it('returns the rendered statement, catalog data, limits and authors to anonymous viewers', async () => {
    const detail = detailOf(
      await api.http().get(`${PROBLEMS}/sum`).expect(200),
    );
    expect(detail).toMatchObject({
      code: 'sum',
      name: 'Tổng',
      language: 'vi',
      translated: true,
      descriptionHtml: '<p>Cộng <span class="katex">…</span>.</p>',
      source: 'VOI',
      timeLimit: 1,
      memoryLimit: 262144,
      points: 1000,
      group: { fullName: 'Uncategorized' },
      types: [{ name: 'uncategorized' }],
      license: { key: 'mit' },
      authors: [{ id: authorId, username: 'author' }],
      languageLimits: [{ language: 'PY3', timeLimit: 3, memoryLimit: 262144 }],
      availableTranslations: ['en'],
      hasEditorial: true,
      canEdit: false,
      editor: null,
    });
    expect(detail.authors).toEqual([{ id: authorId, username: 'author' }]);
    expect(
      detailOf(
        await authed(api.http().get(`${PROBLEMS}/sum`), pendingAuthor).expect(
          200,
        ),
      ),
    ).toMatchObject({ canEdit: false, editor: null });
    expect(detail.allowedLanguages.map((language) => language.key)).toEqual([
      'CPP17',
      'PY3',
    ]);
    expect(detail).not.toHaveProperty('description');
  });

  it('serves the Vietnamese base as asked, and English only where translated', async () => {
    const statementOf = async (code: string, lang?: string) =>
      detailOf(
        await api
          .http()
          .get(`${PROBLEMS}/${code}${lang ? `?lang=${lang}` : ''}`)
          .expect(200),
      );
    expect(await statementOf('sum', 'vi')).toMatchObject({
      name: 'Tổng',
      language: 'vi',
      translated: true,
    });
    expect(await statementOf('sum', 'en')).toMatchObject({
      name: 'Sum',
      language: 'en',
      translated: true,
      descriptionHtml: '<p>Add …</p>',
    });
    expect(await statementOf('noeditorial', 'en')).toMatchObject({
      name: 'NOEDITORIAL',
      language: 'vi',
      translated: false,
    });
    expect(await statementOf('noeditorial', 'vi')).toMatchObject({
      language: 'vi',
      translated: true,
    });
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
      description: 'Cộng $a+b$.',
      translations: [
        { language: 'en', name: 'Sum', description: 'Add $a+b$.' },
      ],
      solution: {
        isPublic: true,
        content: 'Just add.',
        authors: [{ id: authorId, username: 'author' }],
      },
      curators: [],
      testers: [],
      suggester: null,
      licenseId: catalog.licenses.mit,
    });
  });

  it('keeps the base name in the editor block whatever the requested language', async () => {
    const detail = detailOf(
      await authed(api.http().get(`${PROBLEMS}/sum?lang=en`), author).expect(
        200,
      ),
    );
    expect(detail.name).toBe('Sum');
    expect(detail.editor).toMatchObject({ baseName: 'Tổng' });
  });

  it('gates the editorial on publication, permission and editorship', async () => {
    expect(
      editorialOf(
        await api.http().get(`${PROBLEMS}/sum/editorial?lang=en`).expect(200),
      ),
    ).toMatchObject({
      problem: { code: 'sum', name: 'Sum' },
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
    const unknown = await api
      .http()
      .get(`${PROBLEMS}/nope/editorial`)
      .expect(404);
    for (const viewer of [undefined, plain, solutionReader]) {
      const request = api.http().get(`${PROBLEMS}/secret/editorial`);
      const response = await (
        viewer ? authed(request, viewer) : request
      ).expect(404);
      expect(response.body).toEqual(unknown.body);
    }
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

  describe('contest context', () => {
    let racerId: string;
    let racer: TestSession;
    let rounds = 0;
    const contestOf = async (code: string, viewer: TestSession = racer) =>
      detailOf(
        await authed(api.http().get(`${PROBLEMS}/${code}`), viewer).expect(200),
      ).contest;
    /** A fresh running contest the racer has joined and is in; it lists `capped` (3 submissions) and `uncapped`. */
    const enterRound = async (extra: { virtual?: number } = {}) => {
      const contest = await createContest(api, {
        key: `round_${(rounds += 1)}`,
        problems: [
          contestProblem(capped._id, 0, { maxSubmissions: 3 }),
          contestProblem(uncapped._id, 1),
        ],
      });
      const participation = await joinParticipation(
        api,
        contest._id,
        racerId,
        extra,
      );
      await makeCurrent(api, racerId, participation._id);
      return { contest, participation };
    };
    const attempt = async (
      round: { contest: { _id: string }; participation: { _id: string } },
      problemId: string,
      fields: { status?: 'D' | 'IE' | 'PD'; user?: string } = {},
    ) => {
      const submission = await seedSubmission(api, {
        user: fields.user ?? racerId,
        problem: problemId,
        language: catalog.languages.cpp,
        ...(fields.status && { status: fields.status }),
      });
      await api.contestSubmissions.create({
        _id: submission._id,
        participation: round.participation._id,
        contest: round.contest._id,
        problem: problemId,
      });
    };
    let capped: { _id: string };
    let uncapped: { _id: string };

    beforeAll(async () => {
      racerId = (await createUserWith(api, 'racer'))._id;
      racer = await loginAs(api, racerId);
      capped = await createProblem(api, catalog, { code: 'capped' });
      uncapped = await createProblem(api, catalog, { code: 'uncapped' });
    });
    beforeEach(() => makeCurrent(api, racerId, null));

    it('is null outside a contest, for the signed-in and the anonymous', async () => {
      expect(await contestOf('capped')).toBeNull();
      expect(
        detailOf(await api.http().get(`${PROBLEMS}/capped`).expect(200))
          .contest,
      ).toBeNull();
    });

    it('is null in a contest that does not list the problem', async () => {
      const other = await createContest(api, { problems: [] });
      await makeCurrent(
        api,
        racerId,
        (await joinParticipation(api, other._id, racerId))._id,
      );
      expect(await contestOf('capped')).toBeNull();
    });

    it('names the contest and the attempts left while participating', async () => {
      const round = await enterRound();
      expect(await contestOf('capped')).toEqual({
        contestKey: round.contest.key,
        attemptsLeft: 3,
      });
      await attempt(round, capped._id);
      expect(await contestOf('capped')).toEqual({
        contestKey: round.contest.key,
        attemptsLeft: 2,
      });
    });

    it('counts only this participation, and not IE or PD submissions', async () => {
      const round = await enterRound();
      const rival = await enterRound();
      const bystanderId = (await createUserWith(api, 'bystander'))._id;
      const bystander = await joinParticipation(
        api,
        round.contest._id,
        bystanderId,
      );
      await makeCurrent(api, racerId, round.participation._id);
      await attempt(rival, capped._id);
      await attempt({ ...round, participation: bystander }, capped._id, {
        user: bystanderId,
      });
      await attempt(round, capped._id, { status: 'IE' });
      await attempt(round, capped._id, { status: 'PD' });
      expect((await contestOf('capped'))?.attemptsLeft).toBe(3);
      await attempt(round, capped._id);
      expect((await contestOf('capped'))?.attemptsLeft).toBe(2);
    });

    it('has no limit to report when the entry is uncapped', async () => {
      const round = await enterRound();
      await attempt(round, uncapped._id);
      expect(await contestOf('uncapped')).toEqual({
        contestKey: round.contest.key,
        attemptsLeft: null,
      });
    });

    it('never goes below zero', async () => {
      const round = await enterRound();
      for (let count = 0; count < 4; count += 1)
        await attempt(round, capped._id);
      expect((await contestOf('capped'))?.attemptsLeft).toBe(0);
    });
  });
});
