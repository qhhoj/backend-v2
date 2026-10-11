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
import { TagProblemResponse } from '../src/modules/tags/dto/tag.response';

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
    let editor: TestSession, cloner: TestSession, plain: TestSession;
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

    it('creates a tag problem from a link, and only for rating >= 1900 with tagging enabled', async () => {
      const created = dataOf<TagProblemResponse>(
        await authed(api.http().post(TAGS), tagger)
          .send({
            link: 'https://codeforces.com/problemset/problem/1/A',
            name: 'Theatre Square',
          })
          .expect(201),
      );
      expect(created).toMatchObject({ code: 'CF_1_A', judge: 'Codeforces' });
      await authed(api.http().post(TAGS), tagger)
        .send({
          link: 'https://codeforces.com/contest/1/problem/A',
          name: 'Again',
        })
        .expect(409);
      const link = {
        link: 'https://open.kattis.com/problems/hello',
        name: 'H',
      };
      await authed(api.http().post(TAGS), rated)
        .send({
          link: 'https://atcoder.jp/contests/abc001/tasks/abc001_a',
          name: 'ABC 1 A',
        })
        .expect(201);
      for (const denied of [lowRated, optedOut, plain])
        await authed(api.http().post(TAGS), denied).send(link).expect(403);
      await api.http().post(TAGS).send(link).expect(401);
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
  });
}
