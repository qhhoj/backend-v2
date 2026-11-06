import { UUID } from 'mongodb';
import type { Document } from 'mongodb';
import { isLanguageActive, Language } from '@libs/database';
import { setupMigrationsTest } from '../../../test/migrations-setup';
import type { MigrationsTest } from '../../../test/migrations-setup';
import { LanguageActiveFlagMigration } from './language-active-flag.migration';

describe('language active flag migration', () => {
  let test: MigrationsTest;

  beforeAll(async () => {
    test = await setupMigrationsTest();
  });
  afterAll(() => test.teardown());

  const language = (key: string, fields: Document = {}): Document => ({
    _id: new UUID(),
    key,
    name: key,
    updatedAt: new Date('2020-01-01T00:00:00Z'),
    ...fields,
  });
  const keysMatching = async (filter: Document) =>
    (
      await test
        .model(Language.name)
        .collection.find(filter)
        .sort({ _id: 1 })
        .toArray()
    ).map((row) => row.key as string);
  const activeKeys = async () =>
    (await test.stored(Language.name))
      .filter((row) => isLanguageActive(row as unknown as Language))
      .map((row) => row.key as string);

  it('stores active on languages from before the flag, keeps a stored flag, reads the same, and a second run changes nothing', async () => {
    const legacy = [language('CPP17'), language('PY3')];
    const current = [
      language('PAS', { isActive: false }),
      language('JAVA', { isActive: true }),
    ];
    await test
      .model(Language.name)
      .collection.insertMany([...legacy, ...current]);
    const stored = await test.stored(Language.name);
    const hydrated = await test.hydrated(Language.name);
    const active = await activeKeys();
    const signupDefault = await keysMatching({ isActive: { $ne: false } });
    const migration = test.module.get(LanguageActiveFlagMigration);

    expect(await migration.run()).toBe(legacy.length);

    const legacyIds = new Set(legacy.map((row) => String(row._id)));
    expect(await test.stored(Language.name)).toEqual(
      stored.map((row) =>
        legacyIds.has(String(row._id)) ? { isActive: true, ...row } : row,
      ),
    );
    expect(await test.hydrated(Language.name)).toEqual(hydrated);
    expect(await activeKeys()).toEqual(active);
    expect(await keysMatching({ isActive: { $ne: false } })).toEqual(
      signupDefault,
    );
    expect(await keysMatching({ isActive: true })).toEqual(signupDefault);

    const after = await test.stored(Language.name);
    expect(await migration.run()).toBe(0);
    expect(await test.stored(Language.name)).toEqual(after);
  });
});
