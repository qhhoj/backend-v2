import { decrypt, encryptionKey } from '@libs/common';
import { uuidStr } from '@libs/database';
import { Binary, Document } from 'mongodb';
import { readFileSync } from 'node:fs';
import { LEGACY_DEACTIVATED_REASON } from '../src/mappers/users/user-fields';
import { MigrationService } from '../src/migration.service';
import { setupMigratorTest, TEST_KEY } from './setup';

const fixtures = JSON.parse(
  readFileSync('test/fixtures/django.json', 'utf8'),
) as {
  fernet: { plain: string }[];
  webauthnHandles: { handle: string }[];
};

describe('users job', () => {
  let harness: Awaited<ReturnType<typeof setupMigratorTest>>;
  let migration: MigrationService;
  let reports: Record<string, string[]>;
  const user = async (id: number) =>
    (await harness.docOf('users', 'auth_user', id)) as Document | null;

  beforeAll(async () => {
    harness = await setupMigratorTest();
    migration = harness.testingModule.get(MigrationService);
    reports = await migration.backfill(['users']);
  });
  afterAll(() => harness.teardown());

  it('joins account and profile, renders about, keeps legacy numbers', async () => {
    expect(await user(1001)).toMatchObject({
      username: 'ana',
      email: 'ana@example.com',
      firstName: 'Ana',
      isActive: true,
      lastLogin: new Date('2026-01-02T03:04:05Z'),
      dateJoined: new Date('2020-01-01T00:00:00Z'),
      timezone: 'Asia/Ho_Chi_Minh',
      aboutHtml: expect.stringContaining('<strong>hi</strong>') as string,
      points: 12.5,
      performancePoints: 30.25,
      rating: null,
      siteTheme: 'dark',
      permissions: ['judge.edit_all_post'],
      apiTokenHash: null,
      badges: [],
    });
  });

  it('orders organizations by sort value and resolves groups and language', async () => {
    const ana = (await user(1001))!;
    expect((ana.organizations as unknown[]).map(uuidStr)).toEqual([
      uuidStr(await harness.uuidOf('judge_organization', 2)),
      uuidStr(await harness.uuidOf('judge_organization', 1)),
    ]);
    expect((ana.groups as unknown[]).map(uuidStr)).toEqual([
      uuidStr(await harness.uuidOf('auth_group', 1)),
    ]);
    expect(uuidStr(ana.languageId)).toBe(
      uuidStr(await harness.uuidOf('judge_language', 4)),
    );
    expect(ana.socialAuth).toEqual([
      { provider: 'github', uid: '42', extraData: {} },
    ]);
  });

  it('clears and reports dangling references instead of failing', async () => {
    expect((await user(1001))!.currentParticipation).toBeNull();
    expect(reports.users).toEqual(
      expect.arrayContaining([
        'dangling judge_contestparticipation:1999',
        'dangling auth_group:1998',
        'badges not migrated (x3)',
      ]),
    );
  });

  it('migrates admin-deactivated accounts as banned, reports kept staff flags, leaves pending signups reclaimable', async () => {
    expect(await user(1002)).toMatchObject({
      banReason: LEGACY_DEACTIVATED_REASON,
      displayRank: 'banned',
      isUnlisted: true,
      isActive: false,
      isStaff: true,
    });
    expect(reports.users).toContain(
      'staff flags kept on deactivated auth_user:1002',
    );
    expect(await user(1003)).toMatchObject({
      banReason: null,
      isUnlisted: false,
    });
    expect((await user(1004))!.banReason).toBe('cheating');
  });

  it('re-seals the Fernet TOTP secrets and derives the legacy WebAuthn handle', async () => {
    const alice = (await user(1))!;
    const key = encryptionKey(TEST_KEY);
    expect(decrypt(alice.totpKey as string, key)).toBe(
      fixtures.fernet[0].plain,
    );
    expect(decrypt(alice.scratchCodes as string, key)).toBe(
      fixtures.fernet[1].plain,
    );
    expect((alice.webauthnUserHandle as Binary).toString('hex')).toBe(
      fixtures.webauthnHandles[0].handle,
    );
    expect(alice.webauthnCredentials).toMatchObject([
      { name: 'key', credId: 'cred-1', publicKey: 'pk', counter: 3 },
    ]);
  });

  it('gives a user without a profile the profile defaults', async () => {
    expect(await user(6)).toMatchObject({
      username: 'noprofile',
      allowTagging: true,
      webauthnUserHandle: null,
      organizations: [],
    });
  });

  it('verifies clean, including the re-sealed secrets', async () => {
    expect(await migration.verify(['users'])).toBe(0);
  });

  it('aborts on a wrong LEGACY_SECRET_KEY instead of importing 2FA as off', async () => {
    const key = process.env.LEGACY_SECRET_KEY;
    process.env.LEGACY_SECRET_KEY = 'wrong';
    try {
      await expect(migration.backfill(['users'])).rejects.toThrow(
        'LEGACY_SECRET_KEY does not decrypt legacy secrets',
      );
    } finally {
      process.env.LEGACY_SECRET_KEY = key;
    }
  });
});
