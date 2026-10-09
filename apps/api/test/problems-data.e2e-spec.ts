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
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';

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
  let api: ApiTest;
  let catalog: Catalog;
  let editor: TestSession, mass: TestSession, plain: TestSession;
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
    api = await setupApiTest();
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
    mass = await loginAs(api, massUser._id);
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
  afterAll(() => api.teardown());

  it('returns the stored cases, the archive listing and the per-user case limit', async () => {
    const data = dataOf(await get('sum', editor).expect(200));
    expect(data).toMatchObject({
      archive: 'tests.zip',
      customChecker: 'chk.cpp',
      checker: 'standard',
      hasInit: false,
      limits: { softCases: 50, maxCases: 300 },
    });
    expect(data.cases.map(({ input, points }) => [input, points])).toEqual([
      ['1.in', 7],
      ['2.in', 3],
    ]);
    expect(data.archiveFiles).toEqual(['1.in', '1.out', '2.in', '2.out']);
    expect(dataOf(await get('sum', mass).expect(200)).limits.maxCases).toBe(
      9999,
    );
  });

  it('returns the empty defaults for a problem that never had data', async () => {
    expect(dataOf(await get('fresh', editor).expect(200))).toMatchObject({
      archive: null,
      checker: 'standard',
      grader: 'standard',
      feedback: '',
      cases: [],
      archiveFiles: [],
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
      parse(readFileSync(join(api.problemDataRoot, 'sum', 'init.yml'), 'utf8')),
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

  it('keeps stored data intact when the new configuration has no cases', async () => {
    await put('sum', editor, config([])).expect(200);
    expect(dataOf(await get('sum', editor).expect(200))).toMatchObject({
      cases: [],
      archive: 'tests.zip',
      customChecker: 'chk.cpp',
    });
    const revisions = await revisionsOf('sum');
    expect(revisions[revisions.length - 1].changes).toMatchObject({
      cases: {
        before: { count: 4 },
        after: { count: 0, changed: [0, 1, 2, 3] },
      },
    });
  });

  it('stores feedback for a file io name that would leave the judge box', async () => {
    const data = dataOf(
      await put(
        'sum',
        editor,
        config([plainCase(1)], {
          graderArgs: {
            io_method: 'file',
            io_input_file: '../../x',
            io_output_file: '/etc/passwd',
          },
        }),
      ).expect(200),
    );
    expect(data.feedback).toBe('Input/Output file must be a plain file name.');
    expect(data.hasInit).toBe(false);
    expect(existsSync(join(api.problemDataRoot, 'sum', 'init.yml'))).toBe(
      false,
    );
  });

  it('stores feedback and removes init.yml when the cases do not compile', async () => {
    const data = dataOf(
      await put('sum', editor, config([plainCase(9)])).expect(200),
    );
    expect(data.feedback).toBe('Input file for case 1 does not exist: 9.in');
    expect(data.hasInit).toBe(false);
    expect(data.cases).toHaveLength(1);
    expect(existsSync(join(api.problemDataRoot, 'sum', 'init.yml'))).toBe(
      false,
    );
    await authed(api.http().get(`${PROBLEMS}/sum/data/init`), editor).expect(
      404,
    );
    expect(
      dataOf(await put('sum', editor, config([plainCase(1, 0)])).expect(200))
        .feedback,
    ).toBe('Total points must be greater than 0.');
  });

  it('reports a missing archive as feedback, not an error', async () => {
    const data = dataOf(
      await put('fresh', editor, config([plainCase(1)])).expect(200),
    );
    expect(data.feedback).toMatch(/does not exist/);
    expect(data.cases).toHaveLength(1);
  });

  it('serves the generated init.yml as yaml text', async () => {
    await put('sum', editor, config([plainCase(1)])).expect(200);
    const response = await authed(
      api.http().get(`${PROBLEMS}/sum/data/init`),
      editor,
    ).expect(200);
    expect(response.headers['content-type']).toMatch(/^text\/yaml/);
    expect(response.text).toContain('archive: tests.zip');
  });

  it('caps the case count at 300 without judge.create_mass_testcases', async () => {
    const many = bulkCases(301);
    expect(
      fieldsOf(await put('bulk', editor, config(many)).expect(400)),
    ).toHaveProperty('cases');
    expect(
      dataOf(await put('bulk', mass, config(many)).expect(200)).cases,
    ).toHaveLength(301);
    await put('bulk', mass, config(bulkCases(10000))).expect(400);
  });

  it('accepts a 9999-case body above the default 1 MiB limit', async () => {
    const timed = async (count: number) => {
      const body = config(bulkCases(count, { generatorArgs: 'x'.repeat(100) }));
      expect(JSON.stringify(body).length).toBeGreaterThan(
        count > 5000 ? 1024 * 1024 : 0,
      );
      const started = performance.now();
      const data = dataOf(await put('bulk', mass, body).expect(200));
      expect(data.cases).toHaveLength(count);
      return performance.now() - started;
    };
    await timed(2500);
    expect(await timed(9999)).toBeLessThan(15_000);
    expect(dataOf(await get('bulk', mass).expect(200)).cases).toHaveLength(
      9999,
    );
    await put(
      'bulk',
      mass,
      config(bulkCases(1, { generatorArgs: 'y'.repeat(1001) })),
    ).expect(400);
  });

  it('rejects a body over the raised limit, and over-long aggregate arguments', async () => {
    await put(
      'bulk',
      mass,
      config(bulkCases(9999, { generatorArgs: 'x'.repeat(900) })),
    ).expect(413);
    const response = await put(
      'bulk',
      mass,
      config(bulkCases(1500, { generatorArgs: 'x'.repeat(900) })),
    ).expect(400);
    expect(fieldsOf(response)).toHaveProperty('cases');
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
    expect(await invalid({ outputPrefix: 1.5 })).toHaveProperty('outputPrefix');
    expect(await invalid({ outputLimit: 1e300 })).toHaveProperty('outputLimit');
    expect(await invalid({ unicode: 'yes' })).toHaveProperty('unicode');
    expect(await invalid({}, [{ type: 'X' }])).toHaveProperty(['cases.0.type']);
    expect(
      await invalid({}, [{ ...plainCase(1), checker: 'bridged' }]),
    ).toHaveProperty(['cases.0.checker']);
    expect(await invalid({}, [{ ...plainCase(1), points: -2 }])).toHaveProperty(
      ['cases.0.points'],
    );
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
      await invalid({}, [{ ...plainCase(1), generatorArgs: 'x'.repeat(1001) }]),
    ).toHaveProperty(['cases.0.generatorArgs']);
    expect(
      await invalid({}, [{ ...plainCase(1), checkerArgs: [] }]),
    ).toHaveProperty(['cases.0.checkerArgs']);
    await put('sum', editor, {
      checker: 'standard',
      grader: 'standard',
    }).expect(400);
  });

  it('turns hostile argument nesting into a client error, never a 500', async () => {
    const depth = 200000;
    const nested = `${'['.repeat(depth)}${']'.repeat(depth)}`;
    const body = `{"checker":"standard","grader":"standard","cases":[{"type":"C","input":"1.in","output":"1.out","points":1,"checkerArgs":{"a":${nested}}}]}`;
    const response = await authed(
      api.http().put(`${PROBLEMS}/sum/data`),
      editor,
    )
      .set('Content-Type', 'application/json')
      .send(body);
    expect(response.status).toBe(400);
    expect(
      (response.body as { error: { message: string } }).error.message,
    ).toBe('Request body is nested too deeply');
  });

  it('stores empty argument objects as null', async () => {
    const data = dataOf(
      await put(
        'sum',
        editor,
        config([{ ...plainCase(1), checker: 'floats', checkerArgs: {} }], {
          checkerArgs: {},
          graderArgs: {},
        }),
      ).expect(200),
    );
    expect(data).toMatchObject({ checkerArgs: null, graderArgs: null });
    expect(data.cases[0].checkerArgs).toBeNull();
    const reread = dataOf(await get('sum', editor).expect(200));
    expect(reread).toMatchObject({ checkerArgs: null, graderArgs: null });
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
      (await put('sum', editor, { checker: 'standard', cases: 'nope' })).status,
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
      expect(stored.cases.map(({ input }) => input)).toEqual([`${winner}.in`]);
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

  it('applies the access rules: 401, 403, invisible 404, manually managed 404, mirror read-only', async () => {
    await api.http().get(`${PROBLEMS}/sum/data`).expect(401);
    await get('sum', plain).expect(403).expect(errorCode('forbidden'));
    await put('sum', plain, config([])).expect(403);
    await get('hidden', plain).expect(404);
    await get('managed', editor).expect(404);
    await put('managed', editor, config([])).expect(404);
    const mirror = dataOf(await get('mirror', editor).expect(200));
    expect(mirror.cases).toHaveLength(1);
    await put('mirror', editor, config([plainCase(1)])).expect(403);
    expect(dataOf(await get('mirror', editor).expect(200)).cases).toHaveLength(
      1,
    );
    mkdirSync(join(api.problemDataRoot, 'managed'), { recursive: true });
    writeFileSync(join(api.problemDataRoot, 'managed', 'init.yml'), 'x: 1\n');
    await authed(
      api.http().get(`${PROBLEMS}/managed/data/init`),
      editor,
    ).expect(404);
  });
});
