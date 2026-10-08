import { encryptionKey } from '@libs/common';
import { SETTINGS } from './registry';
import {
  changedFields,
  openSetting,
  readSetting,
  redactSetting,
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
    expect(readSetting(smtp, sealed, key)).toBe(SMTP_URL);
  });

  it('seals only the secret fields of an object value', () => {
    const sealed = sealSetting(google, client, key) as Record<string, unknown>;
    expect(sealed).toMatchObject({ enabled: true, clientId: 'public-id' });
    expect(JSON.stringify(sealed)).not.toContain('shh-secret');
    expect(openSetting(google, sealed, key)).toEqual(client);
  });

  it('stores a plain setting as is', () => {
    expect(sealSetting(officialMode, true, key)).toBe(true);
  });

  it('refuses a row sealed with another key', () => {
    const sealed = sealSetting(smtp, SMTP_URL, key);
    expect(() =>
      readSetting(smtp, sealed, encryptionKey('cd'.repeat(32))),
    ).toThrow();
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
});
