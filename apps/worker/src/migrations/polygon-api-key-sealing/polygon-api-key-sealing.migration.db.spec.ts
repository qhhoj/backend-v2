import { UUID } from 'mongodb';
import type { Document } from 'mongodb';
import { encryptionKey } from '@libs/common';
import { TEST_ENV } from '@libs/common/testing';
import { Setting, SettingRevision } from '@libs/database';
import {
  readSetting,
  sealSetting,
  SETTINGS,
  shownRevisionValue,
} from '@libs/settings';
import { setupMigrationsTest } from '../../../test/migrations-setup';
import type { MigrationsTest } from '../../../test/migrations-setup';
import { PolygonApiKeySealingMigration } from './polygon-api-key-sealing.migration';

const KEY = 'polygon.apiKey';
const definition = SETTINGS[KEY];
/** The shape of a Polygon API key: 40 lowercase hex characters, which is also valid base64 of 30 bytes. */
const PLAIN = '0123456789abcdef0123456789abcdef01234567';
const STORED_AT = new Date('2026-10-01T00:00:00Z');

describe('polygon api key sealing migration', () => {
  let test: MigrationsTest;
  let key: Buffer;

  beforeAll(async () => {
    test = await setupMigrationsTest();
    key = encryptionKey(TEST_ENV.ENCRYPTION_KEY);
  });
  afterAll(() => test.teardown());

  const settings = () => test.model(Setting.name).collection;
  const revisions = () => test.model(SettingRevision.name).collection;
  const storedValue = async (id: string) =>
    (await settings().findOne({ _id: id as never }))?.value as unknown;
  /** What the settings admin shows of each revision. */
  const shownRevisions = async () =>
    (await test.stored(SettingRevision.name)).map((row) => ({
      key: row.key as string,
      before: shownRevisionValue(SETTINGS[row.key as typeof KEY], row.before),
      after: shownRevisionValue(SETTINGS[row.key as typeof KEY], row.after),
    }));
  const revision = (
    settingKey: string,
    before: unknown,
    after: unknown,
  ): Document => ({
    _id: new UUID(),
    key: settingKey,
    before,
    after,
    changedFields: ['value'],
    actor: null,
    createdAt: STORED_AT,
  });

  it('seals a plain stored key and redacts plain revisions, reads the same, keeps everything else, and a second run changes nothing', async () => {
    const sealedSecret = sealSetting(SETTINGS['polygon.apiSecret'], 's', key);
    await settings().insertMany([
      {
        _id: KEY as never,
        value: PLAIN,
        updatedBy: null,
        updatedAt: STORED_AT,
      },
      {
        _id: 'polygon.apiSecret' as never,
        value: sealedSecret,
        updatedBy: null,
        updatedAt: STORED_AT,
      },
    ]);
    await revisions().insertMany([
      revision(KEY, '', PLAIN),
      revision(KEY, PLAIN, { set: true }),
      revision(KEY, { set: true }, { set: false }),
      revision('polygon.apiSecret', { set: false }, { set: true }),
    ]);
    const read = readSetting(KEY, definition, await storedValue(KEY), key);
    const shown = await shownRevisions();
    const storedRevisions = await test.stored(SettingRevision.name);
    const migration = test.module.get(PolygonApiKeySealingMigration);

    expect(await migration.run()).toBe(3);

    const sealed = await storedValue(KEY);
    expect(sealed).not.toBe(PLAIN);
    expect(readSetting(KEY, definition, sealed, key)).toBe(read);
    expect(read).toBe(PLAIN);
    expect(await storedValue('polygon.apiSecret')).toBe(sealedSecret);
    expect(
      (await settings().findOne({ _id: KEY as never }))?.updatedAt,
    ).toEqual(STORED_AT);
    expect(await shownRevisions()).toEqual(shown);
    expect(await test.stored(SettingRevision.name)).toEqual(
      storedRevisions.map((row) => ({
        ...row,
        before: shownRevisionValue(definition, row.before),
        after: shownRevisionValue(definition, row.after),
      })),
    );
    expect(
      JSON.stringify(await test.stored(SettingRevision.name)),
    ).not.toContain(PLAIN);

    const after = {
      settings: await test.stored(Setting.name),
      revisions: await test.stored(SettingRevision.name),
    };
    expect(await migration.run()).toBe(0);
    expect({
      settings: await test.stored(Setting.name),
      revisions: await test.stored(SettingRevision.name),
    }).toEqual(after);
  });

  it('never seals a value that is already sealed, even under another ENCRYPTION_KEY', async () => {
    const otherKey = encryptionKey('ab'.repeat(32));
    const sealedElsewhere = sealSetting(definition, PLAIN, otherKey);
    await settings().updateOne(
      { _id: KEY as never },
      { $set: { value: sealedElsewhere } },
    );

    expect(await test.module.get(PolygonApiKeySealingMigration).run()).toBe(0);

    expect(await storedValue(KEY)).toBe(sealedElsewhere);
    expect(readSetting(KEY, definition, sealedElsewhere, otherKey)).toBe(PLAIN);
  });
});
