import { newId } from '@libs/database';
import { ProblemListItemResponse } from '../src/modules/problems/core/dto/problem-list.response';
import {
  authed,
  createProblem,
  createUserWith,
  loginAs,
  seedCatalog,
  detailOf,
  editorialOf,
} from './problem-fixtures';
import { errorCode, setupApiTest } from './setup';
import {
  contestProblem,
  createContest,
  joinParticipation,
  makeCurrent,
} from './contest-fixtures';
import { seedSubmission } from './submission-fixtures';
import { REDIS } from '@libs/common';
import type Redis from 'ioredis';
import { ProblemEvents } from '../src/modules/problems/core/problem.events';
import type { Catalog, TestSession } from './problem-fixtures';
import type { ApiTest } from './setup';
import {
  TagCatalogResponse,
  TagProblemListItemResponse,
  TagProblemResponse,
} from '../src/modules/tags/dto/tag.response';

let api: ApiTest;

beforeAll(async () => {
  api = await setupApiTest();
});
afterAll(() => api.teardown());

// from problems-list.e2e-spec.ts
{
  const LIST = '/api/internal/problems';
  type ListBody = {
    data: ProblemListItemResponse[];
    meta: { page: number; pageSize: number; total: number };
  };
  const codesOf = ({ body }: { body: unknown }) =>
    (body as ListBody).data.map((item) => item.code);

  describe('GET /api/internal/problems', () => {
    beforeAll(() => api.reset());
    let catalog: Catalog;
    let authorUser: Awaited<ReturnType<typeof createUserWith>>;
    let author: TestSession, orgMember: TestSession, plain: TestSession;
    const ORG = newId();
    const day = (offset: number) => new Date(Date.UTC(2026, 0, 1 + offset));

    beforeAll(async () => {
      catalog = await seedCatalog(api);
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
      expect(
        codesOf(await api.http().get(`${LIST}?hasEditorial=true`)),
      ).toEqual(['banana']);
      expect(
        codesOf(await api.http().get(`${LIST}?hasEditorial=false`)),
      ).toEqual(['cpp_tricks', 'cherry', 'apple']);
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
    it('searches translated names and substrings of codes and titles, ignoring accents', async () => {
      const find = async (text: string) =>
        codesOf(
          await api.http().get(`${LIST}?search=${encodeURIComponent(text)}`),
        );
      expect(await find('chuối')).toEqual(['banana']);
      expect(await find('chuoi')).toEqual(['banana']);
      expect(await find('QUA CHUOI')).toEqual(['banana']);
      expect(await find('ppl')).toEqual(['apple']);
      expect(await find('rick')).toEqual(['cpp_tricks']);
      expect(await find('cpp trick')).toEqual(['cpp_tricks']);
      expect(await find('cpp banana')).toEqual([]);
      expect(await find('  ')).toHaveLength(4);
    });
    it('finds a substring of the code or a title with q, escaped and length-capped', async () => {
      const find = async (text: string) =>
        codesOf(await api.http().get(`${LIST}?q=${encodeURIComponent(text)}`));
      expect(await find('PPL')).toEqual(['apple']);
      expect(await find('rick')).toEqual(['cpp_tricks']);
      expect(await find('hu')).toEqual(['banana']);
      expect(await find('.*')).toEqual([]);
      expect(await find('c+')).toEqual(['cpp_tricks']);
      await api
        .http()
        .get(`${LIST}?q=${'x'.repeat(101)}`)
        .expect(400);
    });
    it('never lets q surface a problem the viewer cannot see', async () => {
      const find = async (query: string, session?: TestSession) =>
        codesOf(
          session
            ? await authed(api.http().get(`${LIST}?${query}`), session)
            : await api.http().get(`${LIST}?${query}`),
        );
      expect(await find('q=secret')).toEqual([]);
      expect(await find('q=secret', plain)).toEqual([]);
      expect(await find('q=secret&visibility=all', plain)).toEqual([]);
      expect(await find('q=secret&visibility=all', author)).toEqual(['secret']);
      expect(await find('q=orgonly&visibility=all')).toEqual([]);
      expect(await find('q=orgonly&visibility=all', plain)).toEqual([]);
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
      expect(
        codesOf(await api.http().get(`${LIST}?visibility=private`)),
      ).toEqual([]);
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
}

// from problems-detail.e2e-spec.ts
{
  const PROBLEMS = '/api/internal/problems';

  describe('problem detail and editorial', () => {
    beforeAll(() => api.reset());
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
      catalog = await seedCatalog(api);
      const authorUser = await createUserWith(api, 'author', {
        rating: 1650,
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
        authors: [{ id: authorId, username: 'author', rating: 1650 }],
        languageLimits: [
          { language: 'PY3', timeLimit: 3, memoryLimit: 262144 },
        ],
        availableTranslations: ['en'],
        hasEditorial: true,
        canEdit: false,
        editor: null,
      });
      expect(detail.authors).toEqual([
        { id: authorId, username: 'author', rating: 1650 },
      ]);
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
          await authed(api.http().get(`${PROBLEMS}/hidden`), tester).expect(
            200,
          ),
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
          authors: [{ id: authorId, username: 'author', rating: 1650 }],
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
      await authed(
        api.http().get(`${PROBLEMS}/hidden/editorial`),
        tester,
      ).expect(404);
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
          await authed(api.http().get(`${PROBLEMS}/${code}`), viewer).expect(
            200,
          ),
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
}

// from problems-content.e2e-spec.ts
{
  const PROBLEMS = '/api/internal/problems';

  describe('translations, editorial, clone and preview', () => {
    beforeAll(() => api.reset());
    let catalog: Catalog;
    let editorId: string;
    let editor: TestSession,
      cloner: TestSession,
      plain: TestSession,
      fullMarkup: TestSession;
    const statementChanges: string[] = [];

    beforeAll(async () => {
      catalog = await seedCatalog(api);
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
        curators: [clonerUser._id],
      });
      api.app
        .get(ProblemEvents)
        .on('statementChanged', (problemId) =>
          statementChanges.push(problemId),
        );
    });

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
      expect(
        await api.revisions.countDocuments({ action: 'translation' }),
      ).toBe(2);
      const revision = (await api.revisions.findOne({
        action: 'translation',
      }))!;
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
      expect(await api.revisions.countDocuments({ action: 'editorial' })).toBe(
        1,
      );
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
        .send({ ...body, content: 'Quote “x”' })
        .expect(400)
        .expect(errorCode('validation_failed'));
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
      expect((await preview(editor, 'problem').expect(200)).body).toEqual({
        data: { html: '<h3>T </h3>\n' },
      });
      await preview(editor, 'problem-full').expect(403);
      expect(
        (await preview(fullMarkup, 'problem-full').expect(200)).body,
      ).toEqual({ data: { html: '<h3>T <script>1</script></h3>\n' } });
      await preview(plain, 'problem').expect(403);
      for (let attempt = 0; attempt < 59; attempt++)
        await preview(editor, 'problem', 'x').expect(200);
      await preview(editor, 'problem', 'x')
        .expect(429)
        .expect(errorCode('rate_limited'));
    });
    it('keeps raw html out of a translation on a non-full-markup problem', async () => {
      await authed(api.http().put(`${PROBLEMS}/src/translations/vi`), editor)
        .send({ name: 'x', description: '<script>1</script> x' })
        .expect(204);
      const [translation] = (await api.problems.findOne({ code: 'src' }))!
        .translations;
      expect(translation.descriptionHtml).not.toContain('<script');
      expect(translation.descriptionHtml).toContain('x');
    });

    it('keeps a clone of a full-markup problem full-markup and gated', async () => {
      const detail = detailOf(
        await authed(api.http().post(`${PROBLEMS}/markup/clone`), cloner)
          .send({ code: 'markupcopy' })
          .expect(201),
      );
      expect(detail.isFullMarkup).toBe(true);
      await authed(api.http().patch(`${PROBLEMS}/markupcopy`), cloner)
        .send({ description: '<b>raw</b>' })
        .expect(403)
        .expect(errorCode('forbidden'));
      await authed(
        api.http().put(`${PROBLEMS}/markupcopy/translations/vi`),
        cloner,
      )
        .send({ name: 'x', description: '<b>raw</b>' })
        .expect(403);
    });

    describe('render limits', () => {
      const OVER_TWO_MIB = `${`$${'x'.repeat(28)}$ `.repeat(2000)}\n\n${'#\n'.repeat(68000)}`;
      const limitFieldsOf = ({ body }: { body: unknown }) =>
        (body as { error: { fields: Record<string, string[]> } }).error.fields;

      beforeAll(async () => {
        const redis = api.app.get<Redis>(REDIS);
        await Promise.all(
          (await redis.keys('rate:*')).map((key) => redis.del(key)),
        );
        await createProblem(api, catalog, {
          code: 'flood',
          authors: [editorId],
        });
      });

      it('saves a formula flood with the excess left as source text', async () => {
        await authed(api.http().patch(`${PROBLEMS}/flood`), editor)
          .send({ description: '$x$ '.repeat(50000) })
          .expect(200);
        const { descriptionHtml } = (await api.problems.findOne({
          code: 'flood',
        }))!;
        expect(Buffer.byteLength(descriptionHtml)).toBeLessThan(
          2 * 1024 * 1024,
        );
        expect(descriptionHtml).toContain('Formula limit exceeded');
      });

      it('rejects markdown that renders past 2 MiB on every statement path', async () => {
        const rejected = (response: { body: unknown }, field: string) =>
          expect(limitFieldsOf(response)).toHaveProperty(field);
        rejected(
          await authed(api.http().patch(`${PROBLEMS}/flood`), editor)
            .send({ description: OVER_TWO_MIB })
            .expect(400)
            .expect(errorCode('validation_failed')),
          'description',
        );
        rejected(
          await authed(
            api.http().put(`${PROBLEMS}/flood/translations/vi`),
            editor,
          )
            .send({ name: 'x', description: OVER_TWO_MIB })
            .expect(400),
          'description',
        );
        rejected(
          await authed(api.http().put(`${PROBLEMS}/flood/editorial`), editor)
            .send({
              isPublic: false,
              publishOn: '2026-01-01T00:00:00Z',
              content: OVER_TWO_MIB,
            })
            .expect(400),
          'content',
        );
        rejected(
          await authed(api.http().post(`${PROBLEMS}/render-preview`), editor)
            .send({ style: 'problem', markdown: OVER_TWO_MIB })
            .expect(400),
          'markdown',
        );
      });
    });
  });
}

// from tags.e2e-spec.ts
{
  const TAGS = '/api/internal/tags';
  const dataOf = <Value>({ body }: { body: unknown }) =>
    (body as { data: Value }).data;
  const fieldsOf = ({ body }: { body: unknown }) =>
    (body as { error: { fields: Record<string, string[]> } }).error.fields;

  describe('tag catalogue', () => {
    beforeAll(() => api.reset());
    let tagger: TestSession,
      rated: TestSession,
      lowRated: TestSession,
      optedOut: TestSession,
      plain: TestSession;
    let taggerId: string;

    beforeAll(async () => {
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
        again.assignments.find(
          (assignment) => assignment.tag.code === 'knapsack',
        )?.assigner?.username,
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
        assigner: { id: taggerId, username: 'tagger', rating: null },
      });
      await api.http().get(`${TAGS}/GHOST`).expect(404);
      await api.http().get(`${TAGS}/not%20a%20code`).expect(404);
    });
    it('rejects bad input and resolves codes case-insensitively', async () => {
      const tooLong = `https://codeforces.com/problemset/problem/1/${'A'.repeat(40)}`;
      expect(
        fieldsOf(
          await authed(api.http().post(TAGS), tagger)
            .send({ link: tooLong, name: 'X' })
            .expect(400),
        ),
      ).toHaveProperty('link');
      expect(
        fieldsOf(
          await authed(api.http().post(TAGS), tagger)
            .send({ link: 'https://oj.vnoi.info/problem/post', name: '   ' })
            .expect(400),
        ),
      ).toHaveProperty('name');
      await authed(api.http().post(TAGS), tagger)
        .send({ link: 'https://oj.vnoi.info/problem/post', name: '  Post  ' })
        .expect(201);
      const found = dataOf<TagProblemResponse>(
        await api.http().get(`${TAGS}/vnoj_POST`).expect(200),
      );
      expect(found).toMatchObject({ code: 'VNOJ_post', name: 'Post' });

      await api
        .http()
        .post(`${TAGS}/VNOJ_post/assign`)
        .send({ tagCodes: ['bfs'] })
        .expect(401);
      const assigned = dataOf<TagProblemResponse>(
        await authed(api.http().post(`${TAGS}/vnoj_post/assign`), tagger)
          .send({ tagCodes: ['BFS', 'bfs', 'dp-basic', 'bfs'] })
          .expect(200),
      );
      expect(assigned.tags.map((tag) => tag.code)).toEqual(['bfs', 'dp-basic']);
      await authed(api.http().post(`${TAGS}/VNOJ_post/assign`), tagger)
        .send({ tagCodes: ['knapsack'] })
        .expect(200);
      const revisions = await api.revisions
        .find({ entity: 'tagProblem', action: 'assign', entityId: found.id })
        .sort({ createdAt: 1 })
        .lean();
      expect(revisions.map((revision) => revision.changes)).toEqual([
        { tags: { before: [], after: ['bfs', 'dp-basic'] } },
        {
          tags: {
            before: ['bfs', 'dp-basic'],
            after: ['bfs', 'dp-basic', 'knapsack'],
          },
        },
      ]);
      expect(
        dataOf<TagProblemListItemResponse[]>(
          await api.http().get(`${TAGS}?tag=BFS`).expect(200),
        ).map((item) => item.code),
      ).toEqual(['CF_1_A', 'VNOJ_post']);
      await api.http().get(`${TAGS}?judges=Bogus`).expect(400);
    });
  });
}
