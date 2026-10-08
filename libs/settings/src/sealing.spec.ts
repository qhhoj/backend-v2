import { encrypt, encryptionKey } from '@libs/common';
import { SETTINGS } from './registry';
import { SettingError } from './setting-types';
import {
  changedFields,
  openSetting,
  readSetting,
  redactSetting,
  restorableValue,
  sealSetting,
} from './sealing';

const key = encryptionKey('ab'.repeat(32));
const smtp = SETTINGS['mail.smtpUrl'];
const google = SETTINGS['auth.google'];
const officialMode = SETTINGS['contest.officialMode'];
const SMTP_URL = 'smtp://mailer:p4ssw0rd@mail.test:587';
const client = {
  enabled: true,
  clientId: 'public-id',
  clientSecret: 'shh-secret',
};

describe('sealing', () => {
  it('seals a whole-value secret and opens it again', () => {
    const sealed = sealSetting(smtp, SMTP_URL, key);
    expect(typeof sealed).toBe('string');
    expect(JSON.stringify(sealed)).not.toContain('p4ssw0rd');
    expect(readSetting('mail.smtpUrl', smtp, sealed, key)).toBe(SMTP_URL);
  });

  it('seals only the secret fields of an object value', () => {
    const sealed = sealSetting(google, client, key) as Record<string, unknown>;
    expect(sealed).toMatchObject({ enabled: true, clientId: 'public-id' });
    expect(JSON.stringify(sealed)).not.toContain('shh-secret');
    expect(openSetting('auth.google', google, sealed, key)).toEqual(client);
  });

  it('stores a plain setting as is', () => {
    expect(sealSetting(officialMode, true, key)).toBe(true);
  });

  it('refuses a row sealed with another key', () => {
    const sealed = sealSetting(smtp, SMTP_URL, key);
    expect(() =>
      readSetting('mail.smtpUrl', smtp, sealed, encryptionKey('cd'.repeat(32))),
    ).toThrow();
  });

  it('rejects an unopenable row with a fixed message that never quotes the underlying error', () => {
    const wrongKey = encryptionKey('cd'.repeat(32));
    const unparsable = encrypt('{not json p4ssw0rd', key);
    for (const [definition, stored] of [
      [smtp, sealSetting(smtp, SMTP_URL, wrongKey)],
      [smtp, unparsable],
      [smtp, 42],
      [google, { ...client, clientSecret: unparsable }],
    ] as const)
      expect(() =>
        openSetting('mail.smtpUrl', definition, stored, key),
      ).toThrow(new SettingError('Setting mail.smtpUrl cannot be opened'));
  });

  it('redacts secrets and keeps public fields', () => {
    expect(redactSetting(smtp, SMTP_URL)).toEqual({ set: true });
    expect(redactSetting(smtp, '')).toEqual({ set: false });
    const redacted = redactSetting(google, client);
    expect(redacted).toEqual({
      enabled: true,
      clientId: 'public-id',
      clientSecret: { set: true },
    });
    expect(
      JSON.stringify([redactSetting(smtp, SMTP_URL), redacted]),
    ).not.toMatch(/p4ssw0rd|shh-secret/);
    expect(redactSetting(officialMode, true)).toBe(true);
  });

  it('names what changed without values', () => {
    expect(changedFields(client, { ...client, clientSecret: 'new' })).toEqual([
      'clientSecret',
    ]);
    expect(
      changedFields(client, {
        ...client,
        enabled: false,
        clientId: 'x',
      }).sort(),
    ).toEqual(['clientId', 'enabled']);
    expect(changedFields('a', 'b')).toEqual(['value']);
    expect(changedFields(false, false)).toEqual([]);
    expect(
      changedFields({ default: 'u1' }, { default: 'u1', on_new_comment: 'u2' }),
    ).toEqual(['on_new_comment']);
  });

  it('restores a plain setting as its revision stored it', () => {
    expect(restorableValue(officialMode, true)).toBe(true);
  });

  it('restores an object setting without its secret fields, so a merge keeps the stored secret', () => {
    const redacted = redactSetting(google, client);
    expect(restorableValue(google, redacted)).toEqual({
      enabled: true,
      clientId: 'public-id',
    });
  });

  it('has nothing to restore for a whole-value secret', () => {
    expect(
      restorableValue(smtp, redactSetting(smtp, SMTP_URL)),
    ).toBeUndefined();
  });
});
