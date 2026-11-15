import { UUID } from 'mongodb';
import type { Document } from 'mongodb';
import { Problem } from '@libs/database';
import { setupMigrationsTest } from '../../../test/migrations-setup';
import type { MigrationsTest } from '../../../test/migrations-setup';
import { ProblemSetupFlagsMigration } from './problem-setup-flags.migration';

describe('problem setup flags migration', () => {
  let test: MigrationsTest;

  beforeAll(async () => {
    test = await setupMigrationsTest();
  });
  afterAll(() => test.teardown());

  const problem = (code: string, fields: Document = {}): Document => ({
    _id: new UUID(),
    code,
    name: code,
    description: '',
    translations: [],
    data: null,
    updatedAt: new Date('2020-01-01T00:00:00Z'),
    ...fields,
  });
  const stored = (code: string) =>
    test.model(Problem.name).collection.findOne({ code });

  it('stores the flags on legacy rows only, leaves updatedAt alone, and a second run changes nothing', async () => {
    const flagged = { hasStatement: true, hasTests: true, hasPoints: true };
    await test.model(Problem.name).collection.insertMany([
      problem('ready', {
        description: 'Sum two numbers',
        data: { cases: [{ type: 'C', points: 1 }] },
      }),
      problem('blank'),
      problem('current', { setup: flagged, isSetupUnfinished: false }),
    ]);
    const migration = test.module.get(ProblemSetupFlagsMigration);

    expect(await migration.run()).toBe(2);

    expect(await stored('ready')).toMatchObject({
      setup: flagged,
      isSetupUnfinished: false,
      updatedAt: new Date('2020-01-01T00:00:00Z'),
    });
    expect(await stored('blank')).toMatchObject({
      setup: { hasStatement: false, hasTests: false, hasPoints: false },
      isSetupUnfinished: true,
    });
    const after = await test.stored(Problem.name);
    expect(await migration.run()).toBe(0);
    expect(await test.stored(Problem.name)).toEqual(after);
  });
});
