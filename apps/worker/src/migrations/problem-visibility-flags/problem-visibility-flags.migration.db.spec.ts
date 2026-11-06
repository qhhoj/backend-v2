import { UUID } from 'mongodb';
import type { Document } from 'mongodb';
import { Problem } from '@libs/database';
import { setupMigrationsTest } from '../../../test/migrations-setup';
import type { MigrationsTest } from '../../../test/migrations-setup';
import { ProblemVisibilityFlagsMigration } from './problem-visibility-flags.migration';

const DEFAULTS = { isPublic: false, isOrganizationPrivate: false };
/** The editor's guard for a flag stored false (`flagIs(false)`), and what L24 may write instead. */
const TOLERANT = {
  isPublic: { $ne: true },
  isOrganizationPrivate: { $ne: true },
};
const STRICT = DEFAULTS;

describe('problem visibility flags migration', () => {
  let test: MigrationsTest;

  beforeAll(async () => {
    test = await setupMigrationsTest();
  });
  afterAll(() => test.teardown());

  /** A judged problem: the migration must leave its points, limits and data as stored. */
  const problem = (code: string, fields: Document = {}): Document => ({
    _id: new UUID(),
    code,
    name: code,
    points: 12.5,
    partial: true,
    timeLimit: 1.5,
    memoryLimit: 262144,
    data: { checker: 'standard', cases: [{ points: 3 }] },
    updatedAt: new Date('2020-01-01T00:00:00Z'),
    ...fields,
  });
  const codesMatching = async (filter: Document) =>
    (
      await test
        .model(Problem.name)
        .collection.find(filter)
        .sort({ _id: 1 })
        .toArray()
    ).map((row) => row.code as string);

  it('stores false for a missing flag, keeps stored flags and judging fields, reads the same, and a second run changes nothing', async () => {
    const legacy = [
      problem('bare'),
      problem('public-only', { isPublic: true }),
      problem('private-only', { isOrganizationPrivate: true }),
    ];
    const current = [
      problem('hidden', DEFAULTS),
      problem('org', { isPublic: true, isOrganizationPrivate: true }),
    ];
    await test
      .model(Problem.name)
      .collection.insertMany([...legacy, ...current]);
    const stored = await test.stored(Problem.name);
    const hydrated = await test.hydrated(Problem.name);
    const guarded = await codesMatching(TOLERANT);
    const migration = test.module.get(ProblemVisibilityFlagsMigration);

    expect(await migration.run()).toBe(legacy.length);

    const legacyIds = new Set(legacy.map((row) => String(row._id)));
    expect(await test.stored(Problem.name)).toEqual(
      stored.map((row) =>
        legacyIds.has(String(row._id)) ? { ...DEFAULTS, ...row } : row,
      ),
    );
    expect(await test.hydrated(Problem.name)).toEqual(hydrated);
    expect(await codesMatching(TOLERANT)).toEqual(guarded);
    expect(await codesMatching(STRICT)).toEqual(guarded);
    expect([...guarded].sort()).toEqual(['bare', 'hidden']);

    const after = await test.stored(Problem.name);
    expect(await migration.run()).toBe(0);
    expect(await test.stored(Problem.name)).toEqual(after);
  });
});
