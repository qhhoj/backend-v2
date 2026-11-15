import { profileQueries } from '@libs/database/testing';
import {
  authed,
  createProblem,
  createUserWith,
  dataFixture,
  loginAs,
  seedCatalog,
  testCase,
} from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

let api: ApiTest;
let admin: TestSession;
let plain: TestSession;

const PROBLEMS = '/api/internal/problems';
const withTests = dataFixture({
  cases: [testCase({ type: 'C', points: 1 })],
});
const noPointsBatch = dataFixture({
  cases: [
    testCase({ type: 'S', points: 0 }),
    testCase({ type: 'C', points: 5 }),
    testCase({ type: 'E' }),
  ],
});

beforeAll(async () => {
  api = await setupApiTest();
  await api.reset();
  const catalog = await seedCatalog(api);
  admin = await loginAs(
    api,
    (
      await createUserWith(api, 'setupadmin', {
        permissions: ['judge.edit_own_problem', 'judge.edit_all_problem'],
      })
    )._id,
  );
  plain = await loginAs(api, (await createUserWith(api, 'plainuser'))._id);
  const make = (code: string, fields: Record<string, unknown>) =>
    createProblem(api, catalog, { code, ...fields });
  await make('ready', { description: 'Add a and b.', data: withTests });
  await make('nostatement', { description: '  ', data: withTests });
  await make('translated', {
    description: '',
    translations: [
      {
        language: 'en',
        name: 'T',
        description: 'Only English.',
        descriptionHtml: '',
      },
    ],
    data: withTests,
  });
  await make('notests', { description: 'Add a and b.', data: null });
  await make('nopoints', { description: 'Add a and b.', data: noPointsBatch });
});
afterAll(() => api.teardown());

const idOf = async (code: string) =>
  (await api.problems.findOne({ code }, { _id: 1 }).lean<{ _id: string }>())!
    ._id;
const list = async (session: TestSession | null, query: string) => {
  const request = api.http().get(`${PROBLEMS}?${query}`);
  const { body } = (await (session ? authed(request, session) : request).expect(
    200,
  )) as { body: { data: { code: string; setup?: unknown }[] } };
  return body.data;
};
const codes = (items: { code: string }[]) =>
  items.map(({ code }) => code).sort();

describe('problem setup flags', () => {
  it('reports each flag on the editor list by the setup rule', async () => {
    const items = await list(admin, 'visibility=all&editable=true');
    const setupOf = (code: string) =>
      items.find((item) => item.code === code)?.setup;
    expect(setupOf('ready')).toEqual({
      hasStatement: true,
      hasTests: true,
      hasPoints: true,
    });
    expect(setupOf('nostatement')).toEqual({
      hasStatement: false,
      hasTests: true,
      hasPoints: true,
    });
    expect(setupOf('translated')).toMatchObject({ hasStatement: true });
    expect(setupOf('notests')).toEqual({
      hasStatement: true,
      hasTests: false,
      hasPoints: false,
    });
    expect(setupOf('nopoints')).toEqual({
      hasStatement: true,
      hasTests: true,
      hasPoints: false,
    });
  });

  it('keeps the flags current when the statement, test data or a translation is written', async () => {
    await api.problems.updateOne(
      { _id: await idOf('nostatement') },
      { $set: { description: 'Now written.' } },
    );
    await api.problems.updateOne(
      { _id: await idOf('notests') },
      { $set: { data: withTests } },
    );
    await api.problems.updateOne(
      { _id: await idOf('ready') },
      { $set: { 'data.cases': [] } },
    );
    const items = await list(admin, 'visibility=all&editable=true');
    const setupOf = (code: string) =>
      items.find((item) => item.code === code)?.setup;
    expect(setupOf('nostatement')).toMatchObject({ hasStatement: true });
    expect(setupOf('notests')).toMatchObject({
      hasTests: true,
      hasPoints: true,
    });
    expect(setupOf('ready')).toMatchObject({
      hasTests: false,
      hasPoints: false,
    });
    await api.problems.updateOne(
      { _id: await idOf('ready') },
      { $set: { data: withTests } },
    );
    await api.problems.updateOne(
      { _id: await idOf('nostatement') },
      { $set: { description: ' ' } },
    );
    await api.problems.updateOne(
      { _id: await idOf('notests') },
      { $set: { data: null } },
    );
    expect(
      (await list(admin, 'visibility=all&editable=true&status=unfinished'))
        .map(({ code }) => code)
        .sort(),
    ).toEqual(['nopoints', 'nostatement', 'notests']);
  });

  it('filters to unfinished problems with an index', async () => {
    let items: { code: string }[] = [];
    const operations = await profileQueries(api.db, async () => {
      items = await list(
        admin,
        'visibility=all&editable=true&status=unfinished',
      );
    });
    expect(codes(items)).toEqual(['nopoints', 'nostatement', 'notests']);
    const reads = operations.filter(
      ({ collection }) => collection === 'problems',
    );
    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) {
      expect(read.planSummary).not.toContain('COLLSCAN');
      expect(read.docsExamined).toBeLessThanOrEqual(3);
    }
  });

  it('hides readiness from viewers who cannot edit', async () => {
    for (const session of [null, plain])
      for (const item of await list(session, 'visibility=public'))
        expect(item).not.toHaveProperty('setup');
    expect(await list(plain, 'visibility=all&status=unfinished')).toEqual([]);
    expect(await list(null, 'status=unfinished')).toEqual([]);
  });
});
