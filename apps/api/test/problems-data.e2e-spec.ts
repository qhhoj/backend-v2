import { ProblemsRepository } from '../src/modules/problems/core/problems.repository';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { ProblemDataResponse } from '../src/modules/problems/data/dto/problem-data.response';
import {
  authed,
  createProblem,
  createUserWith,
  dataFixture,
  loginAs,
  seedCatalog,
  testCase,
  writeDataArchive,
} from './problem-fixtures';
import type { Catalog, TestSession } from './problem-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

let api: ApiTest;

beforeAll(async () => {
  api = await setupApiTest();
});
afterAll(() => api.teardown());

// from problems-data.e2e-spec.ts
{
  const PROBLEMS = '/api/internal/problems';
  const dataOf = ({ body }: { body: unknown }) =>
    (body as { data: ProblemDataResponse }).data;
  const fieldsOf = ({ body }: { body: unknown }) =>
    (body as { error: { fields: Record<string, string[]> } }).error.fields;
  const plainCase = (index: number, points: number | null = 1) => ({
    type: 'C',
    input: `${index}.in`,
    output: `${index}.out`,
    points,
  });
  const config = (cases: unknown[], extra: Record<string, unknown> = {}) => ({
    checker: 'standard',
    grader: 'standard',
    cases,
    ...extra,
  });
  const bulkCases = (count: number, extra: Record<string, unknown> = {}) =>
    Array.from({ length: count }, (_item, index) => ({
      ...plainCase(index),
      ...extra,
    }));

  describe('problem data editor', () => {
    beforeAll(() => api.reset());
    let catalog: Catalog;
    let editor: TestSession, plain: TestSession;
    let editorId: string;

    const put = (code: string, session: TestSession, body: unknown) =>
      authed(api.http().put(`${PROBLEMS}/${code}/data`), session).send(
        body as object,
      );
    const get = (code: string, session: TestSession) =>
      authed(api.http().get(`${PROBLEMS}/${code}/data`), session);
    const revisionsOf = async (code: string) => {
      const problem = await api.problems.findOne({ code });
      return api.revisions
        .find({ entityId: problem!._id, action: 'data' })
        .lean();
    };

    beforeAll(async () => {
      catalog = await seedCatalog(api);
      editorId = (
        await createUserWith(api, 'editor', {
          permissions: ['judge.edit_own_problem'],
        })
      )._id;
      const massUser = await createUserWith(api, 'mass', {
        permissions: ['judge.edit_own_problem', 'judge.create_mass_testcases'],
      });
      const plainUser = await createUserWith(api, 'plain');
      editor = await loginAs(api, editorId);
      plain = await loginAs(api, plainUser._id);
      const authors = [editorId, massUser._id];
      await createProblem(api, catalog, {
        code: 'sum',
        authors,
        data: dataFixture({
          archive: 'tests.zip',
          customChecker: 'chk.cpp',
          customGrader: 'grader.cpp',
          cases: [
            testCase({ input: '1.in', output: '1.out', points: 7 }),
            testCase({ input: '2.in', output: '2.out', points: 3 }),
          ],
        }),
      });
      writeDataArchive(api, 'sum', [
        { name: '1.in', content: '1' },
        { name: '1.out', content: '1' },
        { name: '2.in', content: '2' },
        { name: '2.out', content: '2' },
      ]);
      await createProblem(api, catalog, { code: 'bulk', authors });
      await createProblem(api, catalog, { code: 'fresh', authors });
      await createProblem(api, catalog, { code: 'hidden', isPublic: false });
      await createProblem(api, catalog, {
        code: 'managed',
        authors: [editorId],
        isManuallyManaged: true,
      });
      await createProblem(api, catalog, {
        code: 'mirror',
        authors: [editorId],
        mirrorOf: '0192b0e0-0000-7000-8000-000000000001',
        data: dataFixture({ cases: [testCase({ input: 'm.in', points: 1 })] }),
      });
    });

    it('replaces the stored cases, keeps the uploaded files, writes init.yml and records a summary revision', async () => {
      const body = config(
        [
          { type: 'S', points: 40, isPretest: true },
          plainCase(1, 5),
          { type: 'E' },
          plainCase(2, 60),
        ],
        { unicode: true },
      );
      const data = dataOf(await put('sum', editor, body).expect(200));
      expect(data.feedback).toBe('');
      expect(data.hasInit).toBe(true);
      const { dataVersion } = (await api.problems
        .findOne({ code: 'sum' })
        .lean())!;
      expect(
        readFileSync(join(api.problemDataRoot, 'sum', '.data-version'), 'utf8'),
      ).toBe(`${dataVersion}\n`);
      expect(data.cases).toHaveLength(4);
      expect(data.cases[1]).toMatchObject({ points: null, isPretest: true });
      expect(
        parse(
          readFileSync(join(api.problemDataRoot, 'sum', 'init.yml'), 'utf8'),
        ),
      ).toEqual({
        archive: 'tests.zip',
        checker: 'standard',
        hints: ['unicode'],
        pretest_test_cases: [
          { points: 40, batched: [{ in: '1.in', out: '1.out' }] },
        ],
        test_cases: [{ in: '2.in', out: '2.out', points: 60 }],
      });

      const reread = dataOf(await get('sum', editor).expect(200));
      expect(reread.cases).toEqual(data.cases);
      expect(reread).toMatchObject({
        archive: 'tests.zip',
        customChecker: 'chk.cpp',
        customGrader: 'grader.cpp',
        unicode: true,
      });

      const [revision] = await revisionsOf('sum');
      expect(revision.changes).toMatchObject({
        unicode: { before: false, after: true },
        cases: { before: { count: 2 }, after: { count: 4 } },
      });
      expect(JSON.stringify(revision.changes)).not.toContain('2.out');

      await put('sum', editor, body).expect(200);
      expect(await revisionsOf('sum')).toHaveLength(1);
    });

    it('validates every field, including per-case enums and integers', async () => {
      const invalid = async (
        extra: Record<string, unknown>,
        cases: unknown[] = [plainCase(1)],
      ) => fieldsOf(await put('sum', editor, config(cases, extra)).expect(400));
      expect(await invalid({ checker: 'magic' })).toHaveProperty('checker');
      expect(await invalid({ grader: 'magic' })).toHaveProperty('grader');
      expect(await invalid({ checkerArgs: 'text' })).toHaveProperty(
        'checkerArgs',
      );
      expect(await invalid({ outputLimit: -1 })).toHaveProperty('outputLimit');
      expect(await invalid({ outputPrefix: 1.5 })).toHaveProperty(
        'outputPrefix',
      );
      expect(await invalid({ outputLimit: 1e300 })).toHaveProperty(
        'outputLimit',
      );
      expect(await invalid({ unicode: 'yes' })).toHaveProperty('unicode');
      expect(await invalid({}, [{ type: 'X' }])).toHaveProperty([
        'cases.0.type',
      ]);
      expect(
        await invalid({}, [{ ...plainCase(1), checker: 'bridged' }]),
      ).toHaveProperty(['cases.0.checker']);
      expect(
        await invalid({}, [{ ...plainCase(1), points: -2 }]),
      ).toHaveProperty(['cases.0.points']);
      expect(
        await invalid({}, [{ ...plainCase(1), points: 1.5 }]),
      ).toHaveProperty(['cases.0.points']);
      expect(
        await invalid({}, [{ ...plainCase(1), isPretest: null }]),
      ).toHaveProperty(['cases.0.isPretest']);
      expect(
        await invalid({}, [{ ...plainCase(1), input: 'a\u0000b' }]),
      ).toHaveProperty(['cases.0.input']);
      expect(
        await invalid({}, [{ ...plainCase(1), output: 'x'.repeat(101) }]),
      ).toHaveProperty(['cases.0.output']);
      expect(
        await invalid({}, [
          { ...plainCase(1), generatorArgs: 'x'.repeat(1001) },
        ]),
      ).toHaveProperty(['cases.0.generatorArgs']);
      expect(
        await invalid({}, [{ ...plainCase(1), checkerArgs: [] }]),
      ).toHaveProperty(['cases.0.checkerArgs']);
      await put('sum', editor, {
        checker: 'standard',
        grader: 'standard',
      }).expect(400);
    });

    it('refuses settings the judge would answer with an internal error', async () => {
      const refused = async (
        extra: Record<string, unknown>,
        cases: unknown[] = [plainCase(1)],
      ) => fieldsOf(await put('sum', editor, config(cases, extra)).expect(400));
      expect(await refused({ nobigmath: true })).toHaveProperty('nobigmath');
      const overLimit = 64 * 1024 * 1024 + 1;
      expect(await refused({ outputLimit: overLimit })).toHaveProperty(
        'outputLimit',
      );
      expect(
        await refused({}, [{ ...plainCase(1), outputLimit: overLimit }]),
      ).toHaveProperty(['cases.0.outputLimit']);
      expect(
        await refused({}, [
          { type: 'S', points: 1, outputLimit: overLimit },
          { ...plainCase(1), points: null },
        ]),
      ).toHaveProperty(['cases.0.outputLimit']);
      const atLimit = 64 * 1024 * 1024;
      await put(
        'sum',
        editor,
        config([{ ...plainCase(1), outputLimit: atLimit }], {
          outputLimit: atLimit,
        }),
      ).expect(200);
      expect(
        await refused({}, [
          plainCase(1),
          { ...plainCase(2), checker: 'floats' },
        ]),
      ).toHaveProperty(['cases.1.checker']);
      await put(
        'sum',
        editor,
        config([{ ...plainCase(1), checker: 'standard' }]),
      ).expect(200);
    });

    it('refuses an unauthorised or oversized body before validating its cases', async () => {
      const body = config(bulkCases(9999));
      const median = async (send: () => Promise<number>) => {
        const times: number[] = [];
        for (let round = 0; round < 3; round++) {
          const started = performance.now();
          expect(await send()).toBeGreaterThan(0);
          times.push(performance.now() - started);
        }
        return times.sort((left, right) => left - right)[1];
      };
      const anonymous = await median(
        async () =>
          (await api.http().put(`${PROBLEMS}/sum/data`).send(body)).status,
      );
      const unauthorised = await median(
        async () => (await put('sum', plain, body)).status,
      );
      expect((await put('sum', plain, body)).status).toBe(403);
      expect(unauthorised).toBeLessThan(anonymous * 8 + 100);
      const oversized = await median(
        async () => (await put('sum', editor, body)).status,
      );
      expect((await put('sum', editor, body)).status).toBe(400);
      expect(oversized).toBeLessThan(anonymous * 8 + 100);
      expect(
        (await put('sum', editor, { checker: 'standard', cases: 'nope' }))
          .status,
      ).toBe(400);
      expect((await put('hidden', plain, body)).status).toBe(404);
      expect((await put('mirror', editor, body)).status).toBe(403);
    });

    it('lets exactly one of two concurrent writers win and keeps init.yml in step with Mongo', async () => {
      const repository = api.app.get(ProblemsRepository);
      const original = repository.findByCodeWithData.bind(repository);
      for (let round = 0; round < 10; round++) {
        let arrived = 0;
        let release!: () => void;
        const bothRead = new Promise<void>((resolve) => (release = resolve));
        const spy = jest
          .spyOn(repository, 'findByCodeWithData')
          .mockImplementation(async (code) => {
            const problem = await original(code);
            if (++arrived === 2) release();
            await bothRead;
            return problem;
          });
        const [first, second] = await Promise.all([
          put('sum', editor, config([plainCase(1, 5)])),
          put('sum', editor, config([plainCase(2, 9)])),
        ]);
        spy.mockRestore();
        expect([first.status, second.status].sort()).toEqual([200, 409]);
        expect((first.status === 409 ? first : second).body).toMatchObject({
          error: { code: 'conflict' },
        });
        const winner = first.status === 200 ? 1 : 2;
        const stored = dataOf(await get('sum', editor).expect(200));
        expect(stored.cases.map(({ input }) => input)).toEqual([
          `${winner}.in`,
        ]);
        const init = readFileSync(
          join(api.problemDataRoot, 'sum', 'init.yml'),
          'utf8',
        );
        expect((parse(init) as { test_cases: unknown }).test_cases).toEqual([
          {
            in: `${winner}.in`,
            out: `${winner}.out`,
            points: winner === 1 ? 5 : 9,
          },
        ]);
      }
    });
  });
}

// from problems-data-events.e2e-spec.ts
{
  const PROBLEMS = '/api/internal/problems';
  const waitFor = async (check: () => boolean, timeoutMs = 5000) => {
    const end = Date.now() + timeoutMs;
    while (!check()) {
      if (Date.now() > end)
        throw new Error('timed out waiting for the listener');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };

  describe('problem data and pdf cache follow problem events', () => {
    beforeAll(() => api.reset());
    let catalog: Catalog;
    let editor: TestSession;
    const dataDir = (code: string) => join(api.problemDataRoot, code);
    const pdf = (code: string, lang: string) =>
      join(api.pdfCacheRoot, `${code}.${lang}.pdf`);
    const seedFiles = (code: string) => {
      mkdirSync(dataDir(code), { recursive: true });
      writeFileSync(join(dataDir(code), 'init.yml'), 'x: 1\n');
      mkdirSync(api.pdfCacheRoot, { recursive: true });
      writeFileSync(pdf(code, 'en'), '%PDF-');
      writeFileSync(pdf(code, 'vi'), '%PDF-');
    };
    const rename = (from: string, to: string) =>
      authed(api.http().patch(`${PROBLEMS}/${from}`), editor).send({
        code: to,
      });

    beforeAll(async () => {
      catalog = await seedCatalog(api);
      const editorUser = await createUserWith(api, 'editor', {
        permissions: [
          'judge.edit_own_problem',
          'judge.upload_problem_material',
        ],
      });
      editor = await loginAs(api, editorUser._id);
      for (const code of [
        'sum',
        'blocked',
        'other',
        'staged',
        'broken',
        'recycled',
        'titled',
        'attached',
      ])
        await createProblem(api, catalog, { code, authors: [editorUser._id] });
    });

    it('moves the data directory and drops the old PDFs on rename', async () => {
      seedFiles('sum');
      await rename('sum', 'sum2').expect(200);
      await waitFor(
        () =>
          existsSync(join(dataDir('sum2'), 'init.yml')) &&
          !existsSync(dataDir('sum')),
      );
      await waitFor(
        () => !existsSync(pdf('sum', 'en')) && !existsSync(pdf('sum', 'vi')),
      );
    });
  });
}

// A problem migrated from the old site: Mongo holds the legacy rows, the data directory holds the legacy init.yml.
{
  const PROBLEMS = '/api/internal/problems';
  /** The old site's init.yml for the rows below: pretest, a batch and a custom checker (a case-level checker is refused: the judge grades one checker per problem). */
  const LEGACY_INIT = [
    'archive: tests.zip',
    'pretest_test_cases:',
    '- in: pre/1.in',
    '  out: pre/1.out',
    '  points: 0',
    'test_cases:',
    '- batched:',
    '  - in: sub1/1.in',
    '    out: sub1/1.out',
    '  - in: sub1/2.in',
    '    out: sub1/2.out',
    '  points: 40',
    '- in: sub2/1.in',
    '  out: sub2/1.out',
    '  points: 60',
    'checker:',
    '  name: bridged',
    '  args:',
    '    files: chk.cpp',
    '    lang: CPP17',
    '    type: testlib',
    '',
  ].join('\n');
  const MIGRATED_CASES = [
    testCase({
      input: 'pre/1.in',
      output: 'pre/1.out',
      points: 0,
      isPretest: true,
    }),
    testCase({ type: 'S', points: 40 }),
    testCase({ input: 'sub1/1.in', output: 'sub1/1.out' }),
    testCase({ input: 'sub1/2.in', output: 'sub1/2.out' }),
    testCase({ type: 'E' }),
    testCase({
      input: 'sub2/1.in',
      output: 'sub2/1.out',
      points: 60,
    }),
  ];
  const ARCHIVE_NAMES = [
    'pre/1.in',
    'pre/1.out',
    'sub1/1.in',
    'sub1/1.out',
    'sub1/2.in',
    'sub1/2.out',
    'sub2/1.in',
    'sub2/1.out',
  ];
  /** The fields the editor sends back: everything it was given except the read-only ones. */
  const editorBody = (data: ProblemDataResponse) => ({
    checker: data.checker,
    checkerArgs: data.checkerArgs,
    grader: data.grader,
    graderArgs: data.graderArgs,
    outputPrefix: data.outputPrefix,
    outputLimit: data.outputLimit,
    unicode: data.unicode,
    nobigmath: data.nobigmath,
    cases: data.cases,
  });

  describe('a migrated problem in the data editor', () => {
    beforeAll(() => api.reset());
    let editor: TestSession;
    const dir = (code: string) => join(api.problemDataRoot, code);
    const fileOf = (code: string, name: string) =>
      readFileSync(join(dir(code), name));

    /** As the migration left it: legacy rows (graderArgs `{}`, dataVersion 0), the legacy files and init.yml. */
    async function seedMigrated(
      code: string,
      authors: string[],
      catalog: Catalog,
    ) {
      await createProblem(api, catalog, {
        code,
        authors,
        data: dataFixture({
          archive: 'tests.zip',
          customChecker: 'chk.cpp',
          checker: 'bridged',
          checkerArgs: { files: 'chk.cpp', lang: 'CPP17', type: 'testlib' },
          graderArgs: {},
          cases: MIGRATED_CASES,
        }),
      });
      writeDataArchive(
        api,
        code,
        ARCHIVE_NAMES.map((name) => ({ name, content: name })),
      );
      writeFileSync(join(dir(code), 'chk.cpp'), 'int main() {}\n');
      writeFileSync(join(dir(code), 'init.yml'), LEGACY_INIT);
    }
    const get = (code: string) =>
      authed(api.http().get(`${PROBLEMS}/${code}/data`), editor).expect(200);
    const put = (code: string, body: object) =>
      authed(api.http().put(`${PROBLEMS}/${code}/data`), editor)
        .send(body)
        .expect(200);

    beforeAll(async () => {
      const catalog = await seedCatalog(api);
      const user = await createUserWith(api, 'editor', {
        permissions: ['judge.edit_own_problem'],
      });
      editor = await loginAs(api, user._id);
      for (const code of ['legacy', 'edited'])
        await seedMigrated(code, [user._id], catalog);
    });

    it('shows the migrated cases, checker and archive', async () => {
      const response = await get('legacy');
      const data = (response.body as { data: ProblemDataResponse }).data;
      expect(data).toMatchObject({
        archive: 'tests.zip',
        customChecker: 'chk.cpp',
        checker: 'bridged',
        feedback: '',
        hasInit: true,
      });
      expect(data.cases).toEqual(MIGRATED_CASES);
      expect([...data.archiveFiles].sort()).toEqual([...ARCHIVE_NAMES].sort());
    });

    it('saved unchanged, judges the same: same init.yml, same files, same rows', async () => {
      const archive = fileOf('legacy', 'tests.zip');
      const checker = fileOf('legacy', 'chk.cpp');
      const shown = (await get('legacy')).body as { data: ProblemDataResponse };
      const saved = (await put('legacy', editorBody(shown.data))).body as {
        data: ProblemDataResponse;
      };
      expect(saved.data.feedback).toBe('');
      expect(saved.data.cases).toEqual(MIGRATED_CASES);
      expect(parse(fileOf('legacy', 'init.yml').toString())).toEqual(
        parse(LEGACY_INIT),
      );
      expect(fileOf('legacy', 'tests.zip').equals(archive)).toBe(true);
      expect(fileOf('legacy', 'chk.cpp').equals(checker)).toBe(true);
      expect(fileOf('legacy', '.data-version').toString()).toBe('1\n');
    });

    it('one edit changes only that setting in init.yml', async () => {
      const shown = (await get('edited')).body as { data: ProblemDataResponse };
      await put('edited', { ...editorBody(shown.data), unicode: true });
      expect(parse(fileOf('edited', 'init.yml').toString())).toEqual({
        ...(parse(LEGACY_INIT) as object),
        hints: ['unicode'],
      });
    });
  });
}
