import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getModelToken } from '@nestjs/mongoose';
import { Logger } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { encrypt, encryptionKey, EnvModule } from '@libs/common';
import { TEST_ENV } from '@libs/common/testing';
import { DatabaseModule, Setting, SettingRevision } from '@libs/database';
import { startMongo } from '@libs/database/testing';
import type { TestMongo } from '@libs/database/testing';
import type { Model } from 'mongoose';
import { SettingError } from './setting-types';
import { SettingsModule } from './settings.module';
import { SettingsQuerier } from './settings.querier';
import { SettingsService } from './settings.service';

const waitFor = async (check: () => boolean, timeoutMs = 20000) => {
  for (
    const end = Date.now() + timeoutMs;
    !check();
    await new Promise((resolve) => setTimeout(resolve, 50))
  )
    if (Date.now() > end) throw new Error('timeout');
};

describe('settings', () => {
  let replSet: TestMongo;
  let first: TestingModule;
  let second: TestingModule;
  let settings: SettingsService;
  let rows: Model<Setting>;
  let revisions: Model<SettingRevision>;
  let mediaRoot: string;
  const boot = async () => {
    const module = await Test.createTestingModule({
      imports: [
        ScheduleModule.forRoot(),
        EnvModule,
        DatabaseModule,
        SettingsModule,
      ],
    }).compile();
    await module.init();
    return module;
  };

  beforeAll(async () => {
    replSet = await startMongo();
    mediaRoot = mkdtempSync(join(tmpdir(), 'qhhoj-settings-'));
    Object.assign(process.env, TEST_ENV, {
      // Streams must run: the cross-process test waits for them, not for the one-minute resync.
      DISABLE_MONGODB_STREAM: 'false',
      MONGO_URL: replSet.getUri('qhhoj'),
      MEDIA_ROOT: join(mediaRoot, 'media'),
      PROBLEM_DATA_ROOT: join(mediaRoot, 'problems'),
      PDF_CACHE_ROOT: join(mediaRoot, 'pdf'),
    });
    first = await boot();
    second = await boot();
    settings = first.get(SettingsService);
    rows = first.get(getModelToken(Setting.name));
    revisions = first.get(getModelToken(SettingRevision.name));
  });
  afterAll(async () => {
    await first.close();
    await second.close();
    await replSet.stop();
    rmSync(mediaRoot, { recursive: true, force: true });
  });

  it('answers the registry default until a value is stored', () => {
    expect(settings.get('contest.officialMode')).toBe(false);
    expect(settings.get('pdf.maxBytes')).toBe(52_428_800);
  });

  it('applies a write at once in its own process and within seconds in another', async () => {
    await settings.set('contest.banAfterDisqualifications', 3, null);
    expect(settings.get('contest.banAfterDisqualifications')).toBe(3);
    await waitFor(
      () =>
        second.get(SettingsService).get('contest.banAfterDisqualifications') ===
        3,
    );
  });

  it('stores secrets sealed and answers them in clear to readers', async () => {
    await settings.set('mail.smtpUrl', 'smtp://u:p4ss@mail.test:587', null);
    expect(settings.get('mail.smtpUrl')).toBe('smtp://u:p4ss@mail.test:587');
    expect(
      JSON.stringify(await rows.findById('mail.smtpUrl').lean()),
    ).not.toContain('p4ss');
  });

  it('writes a redacted revision naming the changed fields', async () => {
    await settings.set(
      'auth.google',
      { enabled: true, clientId: 'cid', clientSecret: 'sec-1' },
      null,
    );
    await settings.set('auth.google', { clientSecret: 'sec-2' }, null);
    const [latest, created] = await revisions
      .find({ key: 'auth.google' })
      .sort({ _id: -1 })
      .lean();
    expect(latest.changedFields).toEqual(['clientSecret']);
    expect(latest.after).toEqual({
      enabled: true,
      clientId: 'cid',
      clientSecret: { set: true },
    });
    expect(created.changedFields.sort()).toEqual([
      'clientId',
      'clientSecret',
      'enabled',
    ]);
    expect(JSON.stringify([latest, created])).not.toMatch(/sec-1|sec-2/);
  });

  it('keeps both fields under parallel patches', async () => {
    await settings.set(
      'auth.github',
      { enabled: false, clientId: 'x', clientSecret: 'y' },
      null,
    );
    await Promise.all([
      settings.set('auth.github', { clientId: 'new-id' }, null),
      settings.set('auth.github', { clientSecret: 'new-secret' }, null),
    ]);
    expect(settings.get('auth.github')).toMatchObject({
      clientId: 'new-id',
      clientSecret: 'new-secret',
    });
  });

  it('clears the external judge token when its base URL moves to another origin', async () => {
    const actor = randomUUID();
    const tokenRevisions = () =>
      revisions.find({ key: 'externalJudge.apiToken' }).sort({ _id: -1 });
    await settings.set('externalJudge.baseUrl', 'https://pcd.test/base', null);
    await settings.set('externalJudge.apiToken', 'tok-1', null);
    await settings.set('externalJudge.baseUrl', 'https://pcd.test/v2', actor);
    expect(settings.get('externalJudge.apiToken')).toBe('tok-1');

    await settings.set('externalJudge.baseUrl', 'https://other.test/v2', actor);
    expect(settings.get('externalJudge.apiToken')).toBe('');
    const [cleared] = await tokenRevisions().lean();
    expect(cleared).toMatchObject({
      before: { set: true },
      after: { set: false },
      changedFields: ['value'],
    });
    expect(String(cleared.actor)).toBe(actor);
    // a URL change that finds the token empty writes no token revision
    const count = await tokenRevisions().countDocuments();
    await settings.set('externalJudge.baseUrl', 'https://third.test', actor);
    expect(await tokenRevisions().countDocuments()).toBe(count);

    await settings.set('externalJudge.apiToken', 'tok-2', null);
    await settings.set('externalJudge.baseUrl', '', actor);
    expect(settings.get('externalJudge.apiToken')).toBe('');
  });

  it('writes nothing for an invalid patch', async () => {
    const before = await revisions.countDocuments({ key: 'pdf.maxBytes' });
    await expect(settings.set('pdf.maxBytes', -5, null)).rejects.toBeInstanceOf(
      SettingError,
    );
    await expect(
      settings.set('auth.facebook', { enabled: true }, null),
    ).rejects.toBeInstanceOf(SettingError);
    expect(await revisions.countDocuments({ key: 'pdf.maxBytes' })).toBe(
      before,
    );
    expect(await rows.findById('pdf.maxBytes')).toBeNull();
    expect(settings.get('auth.facebook').enabled).toBe(false);
  });

  it('falls back to the default for an unreadable row', async () => {
    await rows.collection.insertOne({
      _id: 'mail.from' as never,
      value: 12345,
      updatedAt: new Date(),
    });
    await rows.collection.insertOne({
      _id: 'removed.key' as never,
      value: 1,
      updatedAt: new Date(),
    });
    await rows.collection.updateOne(
      { _id: 'mail.smtpUrl' as never },
      { $set: { value: 'not-ciphertext' } },
    );
    await first.get(SettingsQuerier).resync();
    expect(settings.get('mail.from')).toBe('QHHOJ <no-reply@qhhoj.local>');
    expect(settings.get('mail.smtpUrl')).toBe('');
    expect(settings.get('contest.banAfterDisqualifications')).toBe(3);
  });

  it('logs an unreadable secret by key only, never its decrypted text', async () => {
    const sealedText = encrypt(
      'hunter2-not-json',
      encryptionKey(TEST_ENV.ENCRYPTION_KEY),
    );
    await rows.collection.updateOne(
      { _id: 'mail.smtpUrl' as never },
      { $set: { value: sealedText, updatedAt: new Date() } },
      { upsert: true },
    );
    const warn = jest.spyOn(Logger.prototype, 'warn');
    try {
      await first.get(SettingsQuerier).resync();
      expect(settings.get('mail.smtpUrl')).toBe('');
      const messages = warn.mock.calls.map(([message]) => String(message));
      expect(messages.some((message) => message.includes('mail.smtpUrl'))).toBe(
        true,
      );
      expect(messages.join('\n')).not.toContain('hunter2');
    } finally {
      warn.mockRestore();
    }
  });

  it('lists revisions newest first', async () => {
    const { items, total } = await first
      .get(SettingsService)
      .revisionsOf('auth.google', 1, 10);
    expect(total).toBe(2);
    expect(items.map((item) => item.changedFields)).toEqual([
      ['clientSecret'],
      expect.arrayContaining(['enabled']),
    ]);
  });
});
