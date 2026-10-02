import fixtures from '../../../test/fixtures/django.json';
import {
  decrypt,
  encrypt,
  encryptionKey,
  legacyFernetDecrypt,
  legacyWebauthnHandle,
} from './crypto';

const key = encryptionKey(
  '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
);

describe('crypto', () => {
  it('round-trips AES-GCM with random IVs', () => {
    const [a, b] = [encrypt('secret', key), encrypt('secret', key)];
    expect(a).not.toBe(b);
    expect(decrypt(a, key)).toBe('secret');
  });
  it('rejects tampered ciphertext', () => {
    const blob = Buffer.from(encrypt('secret', key), 'base64');
    blob[blob.length - 1] ^= 1;
    expect(() => decrypt(blob.toString('base64'), key)).toThrow();
  });
  it('rejects truncated auth tags', () => {
    const b = Buffer.from(encrypt('secret', key), 'base64');
    const short = Buffer.concat([
      b.subarray(0, 12),
      b.subarray(12, 16),
      b.subarray(28),
    ]);
    expect(() => decrypt(short.toString('base64'), key)).toThrow();
  });
  it('rejects too-short blobs', () =>
    expect(() => decrypt('AAAA', key)).toThrow(/invalid ciphertext/));
  it('rejects non-hex keys', () =>
    expect(() => encryptionKey('zz'.repeat(32))).toThrow(/32 bytes/));
  it('rejects wrong key length', () =>
    expect(() => encryptionKey('abcd')).toThrow(/32 bytes/));
  it.each(fixtures.fernet)(
    'decrypts django-fernet-fields token for $plain',
    ({ plain, cipher }) =>
      expect(legacyFernetDecrypt(cipher, fixtures.secretKey)).toBe(plain),
  );
  it('rejects fernet tokens with a bad signature', () =>
    expect(() =>
      legacyFernetDecrypt(fixtures.fernet[0].cipher, 'other-secret'),
    ).toThrow(/invalid fernet token/));
  it.each(fixtures.webauthnHandles)(
    'matches webauthn handle for profile $profileId',
    ({ profileId, handle }) =>
      expect(
        legacyWebauthnHandle(fixtures.secretKey, profileId).toString('hex'),
      ).toBe(handle),
  );
});
