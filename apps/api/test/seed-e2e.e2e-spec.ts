import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyPassword } from '@libs/auth';
import { encryptionKey } from '@libs/common';
import { TEST_ENV } from '@libs/common/testing';
import {
  Language,
  LanguageSchema,
  Problem,
  ProblemSchema,
  Setting,
  SettingSchema,
  User,
  UserSchema,
  uuidStr,
} from '@libs/database';
import { startMongo } from '@libs/database/testing';
import type { TestMongo } from '@libs/database/testing';
import { readSetting, SETTINGS } from '@libs/settings';
import { createConnection } from 'mongoose';
import type { Connection } from 'mongoose';
import { assertSeedAllowed, seedE2e } from '../src/seed/seed-e2e';

describe('seed:e2e', () => {
  let replSet: TestMongo;
  let connection: Connection;
  let root: string;
  const key = encryptionKey(TEST_ENV.ENCRYPTION_KEY);
  const options = () => ({
    problemDataRoot: root,
    adminPassword: 'admin-pass-123',
    userPassword: 'user-pass-123',
    encryptionKey: key,
    judgeName: 'seed-judge',
    judgeKey: 'seed-judge-key',
  });
  const mailRow = () =>
    connection
      .model<Setting>(Setting.name, SettingSchema)
      .findById('mail.smtpUrl')
      .lean();

  beforeAll(async () => {
    replSet = await startMongo();
    connection = await createConnection(replSet.getUri('seed')).asPromise();
    root = mkdtempSync(join(tmpdir(), 'qhhoj-seed-'));
  });
  afterAll(async () => {
    await connection.close();
    await replSet.stop();
    rmSync(root, { recursive: true, force: true });
  });

  it('refuses outside test and development', () => {
    for (const bad of [undefined, '', 'production', 'staging', 'Test'])
      expect(() => assertSeedAllowed(bad)).toThrow(/NODE_ENV/);
    expect(() => assertSeedAllowed('test')).not.toThrow();
    expect(() => assertSeedAllowed('development')).not.toThrow();
  });

  it('creates an admin, a user and a judge-ready problem, and a second run changes nothing', async () => {
    const first = await seedE2e(connection, options());
    expect(first).toEqual({
      admin: 'e2e_admin',
      user: 'e2e_user',
      problems: ['e2e_sum', 'e2e_max'],
      outputProblem: 'e2e_output',
      contests: ['e2e_live', 'e2e_past'],
      language: 'PY3',
      judge: 'seed-judge',
    });
    const users = connection.model(User.name, UserSchema);
    const admin = await users.findOne({ username: 'e2e_admin' });
    expect(admin).toMatchObject({
      isSuperuser: true,
      isStaff: true,
      isActive: true,
    });
    expect(await verifyPassword('admin-pass-123', admin!.password)).toBe(true);
    expect(
      await verifyPassword(
        'user-pass-123',
        (await users.findOne({ username: 'e2e_user' }))!.password,
      ),
    ).toBe(true);
    const problem = await connection
      .model(Problem.name, ProblemSchema)
      .findOne({ code: 'e2e_sum' })
      .select('+data');
    expect(problem).toMatchObject({ isPublic: true, points: 1000 });
    expect(problem!.data!.cases).toHaveLength(1);
    const language = await connection
      .model(Language.name, LanguageSchema)
      .findOne({ key: 'PY3' });
    expect(problem!.allowedLanguages.map(uuidStr)).toEqual([
      uuidStr(language!._id),
    ]);
    for (const file of ['1.in', '1.out', 'init.yml'])
      expect(existsSync(join(root, 'e2e_sum', file))).toBe(true);
    expect(readFileSync(join(root, 'e2e_sum', '.data-version'), 'utf8')).toBe(
      `${problem!.dataVersion}\n`,
    );
    expect(readFileSync(join(root, 'e2e_sum', 'init.yml'), 'utf8')).toContain(
      '1.in',
    );

    const row = await mailRow();
    expect(row).not.toBeNull();
    expect(JSON.stringify(row!.value)).not.toContain('smtp://');
    expect(
      readSetting('mail.smtpUrl', SETTINGS['mail.smtpUrl'], row!.value, key),
    ).toBe('smtp://localhost:1025');

    await users.updateOne(
      { username: 'e2e_user' },
      { password: 'changed-by-test' },
    );
    await seedE2e(connection, {
      ...options(),
      userPassword: 'another-one-123',
    });
    expect(await users.countDocuments({ username: /^e2e_/ })).toBe(2);
    expect(
      await connection
        .model(Problem.name, ProblemSchema)
        .countDocuments({ code: 'e2e_sum' }),
    ).toBe(1);
    expect((await users.findOne({ username: 'e2e_user' }))!.password).toBe(
      'changed-by-test',
    );
  });

  it('seeds a hidden output-only problem whose only language is the OUTPUT zip', async () => {
    await seedE2e(connection, options());
    const problems = connection.model(Problem.name, ProblemSchema);
    const problem = await problems.findOne({ code: 'e2e_output' }).lean();
    expect(problem).toMatchObject({ isPublic: false });
    const languages = await connection
      .model(Language.name, LanguageSchema)
      .find({ _id: { $in: problem!.allowedLanguages } })
      .lean();
    expect(
      languages.map((language) => [
        language.key,
        language.fileOnly,
        language.extension,
        language.includeInProblem,
      ]),
    ).toEqual([['OUTPUT', true, 'zip', false]]);
    expect(readFileSync(join(root, 'e2e_output', '1.out'), 'utf8')).toBe('3\n');
    expect(
      readFileSync(join(root, 'e2e_output', '.data-version'), 'utf8'),
    ).toBe(`${problem!.dataVersion}\n`);
    const sum = await problems.findOne({ code: 'e2e_sum' }).lean();
    expect(sum!.allowedLanguages.map(uuidStr)).not.toContain(
      uuidStr(languages[0]._id),
    );
  });
});
