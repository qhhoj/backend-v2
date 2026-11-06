import type { Model } from 'mongoose';
import { User } from '@libs/database';
import { setupMigrationsTest } from '../../../test/migrations-setup';
import type { MigrationsTest } from '../../../test/migrations-setup';
import { PasswordVerificationBackfillMigration } from './password-verification-backfill.migration';

const MIGRATED = new Date('2020-01-01T00:00:00Z');
const AFTER_GO_LIVE = new Date('2026-10-20T00:00:00Z');
const USABLE = 'pbkdf2_sha256$1000$salt$hash';

describe('password verification backfill migration', () => {
  let test: MigrationsTest;
  let users: Model<User>;

  beforeAll(async () => {
    test = await setupMigrationsTest();
    users = test.model(User.name);
  });
  afterAll(() => test.teardown());

  /** Straight into the collection: the rows predate the field, and `updatedAt` must stay what was stored. */
  const legacyUser = async (
    username: string,
    fields: Record<string, unknown>,
  ): Promise<void> => {
    await users.collection.insertOne({
      username,
      password: USABLE,
      isActive: true,
      socialAuth: [],
      updatedAt: MIGRATED,
      ...fields,
    });
  };
  const flagOf = async (username: string) =>
    (await users.collection.findOne({ username }))!
      .passwordSetBeforeVerification as boolean | undefined;

  it('flags accounts whose password may predate a proven mailbox, writes false on the rest, keeps updatedAt, and a second run changes nothing', async () => {
    await legacyUser('veteran', { dateJoined: MIGRATED });
    await legacyUser('dormant', { dateJoined: MIGRATED, isActive: false });
    await legacyUser('newcomer', { dateJoined: AFTER_GO_LIVE });
    await legacyUser('unusable', { dateJoined: AFTER_GO_LIVE, password: '!x' });
    await legacyUser('social', {
      dateJoined: AFTER_GO_LIVE,
      socialAuth: [{ provider: 'github', uid: 'g-1' }],
    });
    await legacyUser('reset', {
      dateJoined: AFTER_GO_LIVE,
      passwordSetBeforeVerification: false,
    });

    expect(
      await test.module.get(PasswordVerificationBackfillMigration).run(),
    ).toBe(5);

    expect(await flagOf('veteran')).toBe(false);
    expect(await flagOf('dormant')).toBe(true);
    expect(await flagOf('newcomer')).toBe(true);
    expect(await flagOf('unusable')).toBe(false);
    expect(await flagOf('social')).toBe(false);
    expect(await flagOf('reset')).toBe(false);
    expect(
      await users.collection.countDocuments({ updatedAt: { $ne: MIGRATED } }),
    ).toBe(0);
    expect(
      await test.module.get(PasswordVerificationBackfillMigration).run(),
    ).toBe(0);
  });
});
