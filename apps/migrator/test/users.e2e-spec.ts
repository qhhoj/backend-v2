import { hashPassword, verifyPassword } from '@libs/auth';
import { decrypt, encryptionKey } from '@libs/common';
import { uuidStr } from '@libs/database';
import { Binary, Document } from 'mongodb';
import { readFileSync } from 'node:fs';
import { LEGACY_DEACTIVATED_REASON } from '../src/mappers/users/user-fields';
import { AuditService } from '../src/audit.service';
import { MigrationService } from '../src/migration.service';
import { setSkipLegacySecrets } from '../src/rehearsal';
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
  let legacyHash: string;
  let reports: Record<string, string[]>;
  const user = async (id: number) =>
    (await harness.docOf('users', 'auth_user', id)) as Document | null;

  beforeAll(async () => {
    harness = await setupMigratorTest();
    migration = harness.testingModule.get(MigrationService);
    legacyHash = await hashPassword('s3cret pass', 1000);
    await harness.mysql.query(
      'UPDATE auth_user SET password = ? WHERE id = 1001',
      [legacyHash],
    );
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

  it('copies the legacy password hash byte for byte and it still verifies', async () => {
    const ana = (await user(1001))!;
    expect(ana.password).toBe(legacyHash);
    expect(await verifyPassword('s3cret pass', ana.password as string)).toBe(
      true,
    );
    expect(await verifyPassword('wrong pass', ana.password as string)).toBe(
      false,
    );
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
    expect(await user(1005)).toMatchObject({
      banReason: LEGACY_DEACTIVATED_REASON,
      displayRank: 'banned',
      isUnlisted: true,
      isActive: false,
    });
    expect(reports.users).not.toContain(
      'staff flags kept on deactivated auth_user:1005',
    );
    expect((await user(1002))!.isSuperuser).toBe(false);
    expect(await user(1006)).toMatchObject({
      banReason: LEGACY_DEACTIVATED_REASON,
      isActive: false,
    });
    expect(await user(1003)).toMatchObject({
      banReason: null,
      isUnlisted: false,
    });
    expect((await user(1004))!.banReason).toBe('cheating');
  });

  it('re-seals the Fernet TOTP secrets and derives the legacy WebAuthn handle', async () => {
    const alice = (await user(1))!;
    const key = encryptionKey(TEST_KEY);
    expect(alice.isTotpEnabled).toBe(true);
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

  it('lists deactivated superusers in the audit warnings', async () => {
    const { warnings } = await harness.testingModule.get(AuditService).run();
    expect(warnings).toContainEqual(
      expect.stringMatching(/^auth_user deactivated superusers .*: 1 /),
    );
  });

  describe('rehearsal without legacy secrets', () => {
    let saved: NodeJS.ProcessEnv;
    let skipped: Record<string, string[]>;

    beforeAll(async () => {
      saved = { ...process.env };
      delete process.env.LEGACY_SECRET_KEY;
      delete process.env.ENCRYPTION_KEY;
      process.env.MIGRATION_REHEARSAL = '1';
      setSkipLegacySecrets(true);
      skipped = await migration.backfill(['users']);
    });
    afterAll(() => {
      setSkipLegacySecrets(false);
      process.env = saved;
    });

    it('migrates every user with 2FA off and counts the affected ones', async () => {
      expect(await user(1)).toMatchObject({
        username: 'alice',
        isTotpEnabled: false,
        totpKey: null,
        scratchCodes: null,
        isWebauthnEnabled: false,
        webauthnUserHandle: null,
        webauthnCredentials: [],
      });
      expect(skipped.users).toContain(
        'REHEARSAL: legacy secrets skipped, canary skipped, 2FA off for every user',
      );
      expect(skipped.users).toContainEqual(
        expect.stringMatching(
          /^2FA off \(legacy secrets skipped, rehearsal\)( \(x\d+\))?$/,
        ),
      );
    });

    it('verifies clean under the same flag', async () => {
      expect(await migration.verify(['users'])).toBe(0);
    });

    it('still sees sealed secrets of a real run as mismatches', async () => {
      setSkipLegacySecrets(false);
      Object.assign(process.env, {
        LEGACY_SECRET_KEY: saved.LEGACY_SECRET_KEY,
        ENCRYPTION_KEY: saved.ENCRYPTION_KEY,
      });
      await migration.backfill(['users']);
      setSkipLegacySecrets(true);
      expect(await migration.verify(['users'])).toBeGreaterThan(0);
    });

    it('is refused without MIGRATION_REHEARSAL=1', () => {
      delete process.env.MIGRATION_REHEARSAL;
      expect(() => setSkipLegacySecrets(true)).toThrow(
        'needs MIGRATION_REHEARSAL=1',
      );
    });
  });

  describe('canary without TOTP keys', () => {
    const wrongKey = async <T>(run: () => Promise<T>) => {
      const key = process.env.LEGACY_SECRET_KEY;
      process.env.LEGACY_SECRET_KEY = 'wrong';
      try {
        return await run();
      } finally {
        process.env.LEGACY_SECRET_KEY = key;
      }
    };

    it('falls back to a scratch-code canary', async () => {
      await harness.mysql.query(
        `UPDATE ${harness.name}.judge_profile SET totp_key = NULL`,
      );
      await wrongKey(() =>
        expect(migration.backfill(['users'])).rejects.toThrow(
          'LEGACY_SECRET_KEY does not decrypt legacy secrets',
        ),
      );
    });

    it('skips the canary with a report line when no secret exists', async () => {
      await harness.mysql.query(
        `UPDATE ${harness.name}.judge_profile SET scratch_codes = NULL`,
      );
      const skipped = await wrongKey(() => migration.backfill(['users']));
      expect(skipped.users).toContain(
        'no legacy secret to test LEGACY_SECRET_KEY against (canary skipped)',
      );
    });
  });
});
