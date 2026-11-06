import { UUID } from 'mongodb';
import type { Document } from 'mongodb';
import { User } from '@libs/database';
import { setupMigrationsTest } from '../../../test/migrations-setup';
import type { MigrationsTest } from '../../../test/migrations-setup';
import { UserLegacyFieldsMigration } from './user-legacy-fields.migration';

/** A row with every field this migration reads, as v2 writes it; each seed below removes or changes some. */
const CURRENT = {
  password: '!',
  isActive: true,
  isTotpEnabled: false,
  totpKey: null,
  lastTotpTimecode: 0,
  socialAuth: [],
  banReason: null,
  isActiveBeforeBan: null,
  updatedAt: new Date('2020-01-01T00:00:00Z'),
};

describe('user legacy fields migration', () => {
  let test: MigrationsTest;

  beforeAll(async () => {
    test = await setupMigrationsTest();
  });
  afterAll(() => test.teardown());

  const user = (
    username: string,
    fields: Document = {},
    without: string[] = [],
  ): Document => {
    const row: Document = { _id: new UUID(), username, ...CURRENT, ...fields };
    for (const field of without) delete row[field];
    return row;
  };
  const byName = async () =>
    new Map(
      (await test.stored(User.name)).map((row) => [
        row.username as string,
        row,
      ]),
    );
  /** What the api derives from each row today (`isTotpEnrolled`, the unban's `isActiveBeforeBan ?? true`, the timecode CAS for 0, a hydrated `socialAuth`). */
  const reads = async () =>
    (await test.hydrated(User.name)).map((row) => ({
      username: row.username as string,
      totpEnrolled: row.isTotpEnabled === true && !!row.totpKey,
      unbansTo:
        row.banReason === null
          ? null
          : ((row.isActiveBeforeBan as boolean | null) ?? true),
      timecode: (row.lastTotpTimecode as number | null) ?? 0,
      socialAuth: row.socialAuth as unknown,
    }));
  const namesMatching = async (filter: Document) =>
    (await test.model(User.name).collection.find(filter).toArray())
      .map((row) => row.username as string)
      .sort();

  it('stores what the tolerant reads take, changes nothing else, reads the same, and a second run changes nothing', async () => {
    await test.model(User.name).collection.insertMany([
      user('no-timecode', {}, ['lastTotpTimecode']),
      user('null-timecode', { lastTotpTimecode: null }),
      user('flag-no-key', { isTotpEnabled: true }, ['totpKey']),
      user('flag-null-key', { isTotpEnabled: true, lastTotpTimecode: 9 }),
      user('flag-empty-key', { isTotpEnabled: true, totpKey: '' }),
      user('no-social', {}, ['socialAuth']),
      user('banned-before-field', { banReason: 'spam', isActive: false }, [
        'isActiveBeforeBan',
      ]),
      user('banned-null', { banReason: 'spam', isActive: false }),
      user('never-banned', {}, ['isActiveBeforeBan']),
      user('enrolled', {
        isTotpEnabled: true,
        totpKey: 'sealed',
        lastTotpTimecode: 55,
      }),
      user('banned-inactive', {
        banReason: 'spam',
        isActive: false,
        isActiveBeforeBan: false,
      }),
      user('linked', { socialAuth: [{ provider: 'github', uid: 'g-1' }] }),
    ]);
    const stored = await byName();
    const before = await reads();
    const timecodeZero = await namesMatching({
      lastTotpTimecode: { $in: [0, null] },
    });
    const migration = test.module.get(UserLegacyFieldsMigration);

    expect(await migration.run()).toBe(9);

    const changed: Record<string, Document> = {
      'no-timecode': { lastTotpTimecode: 0 },
      'null-timecode': { lastTotpTimecode: 0 },
      'flag-no-key': { isTotpEnabled: false },
      'flag-null-key': { isTotpEnabled: false },
      'flag-empty-key': { isTotpEnabled: false },
      'no-social': { socialAuth: [] },
      'banned-before-field': { isActiveBeforeBan: true },
      'banned-null': { isActiveBeforeBan: true },
      'never-banned': { isActiveBeforeBan: null },
    };
    expect(await byName()).toEqual(
      new Map(
        [...stored].map(([name, row]) => [name, { ...row, ...changed[name] }]),
      ),
    );
    expect(await reads()).toEqual(before);
    expect(
      await namesMatching({ lastTotpTimecode: { $in: [0, null] } }),
    ).toEqual(timecodeZero);
    expect(await namesMatching({ lastTotpTimecode: 0 })).toEqual(timecodeZero);
    expect(await namesMatching({ isTotpEnabled: true })).toEqual(['enrolled']);

    const after = await byName();
    expect(await migration.run()).toBe(0);
    expect(await byName()).toEqual(after);
  });
});
