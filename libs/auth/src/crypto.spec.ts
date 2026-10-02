import fixtures from '../../../test/fixtures/django.json';
import {
  decrypt,
  encrypt,
  encryptionKey,
  legacyFernetDecrypt,
  constantTimeEqual,
  legacyWebauthnHandle,
  randomToken,
  sha256,
} from './crypto';

const key = encryptionKey(
  '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
);

describe('crypto', () => {
  it('compares strings in constant time and rejects non-strings', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    for (const given of ['abd', 'ab', 'abcd', '', undefined, 123, ['abc']])
      expect(constantTimeEqual(given, 'abc')).toBe(false);
  });
  it('hashes sha256 as hex and issues 32-byte url-safe random tokens', () => {
    expect(sha256('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(Buffer.from(randomToken(), 'base64url')).toHaveLength(32);
    expect(randomToken()).not.toBe(randomToken());
  });
  it('round-trips AES-GCM with random IVs', () => {
    const [first, second] = [encrypt('secret', key), encrypt('secret', key)];
    expect(first).not.toBe(second);
    expect(decrypt(first, key)).toBe('secret');
  });
  it('rejects tampered ciphertext', () => {
    const blob = Buffer.from(encrypt('secret', key), 'base64');
    blob[blob.length - 1] ^= 1;
    expect(() => decrypt(blob.toString('base64'), key)).toThrow();
  });
  it('rejects blobs too short to hold a 16-byte tag', () => {
    const blob = Buffer.from(encrypt('secret', key), 'base64');
    const short = Buffer.concat([
      blob.subarray(0, 12),
      blob.subarray(12, 16),
      blob.subarray(28),
    ]);
    expect(() => decrypt(short.toString('base64'), key)).toThrow();
  });
  it('rejects too-short blobs', () =>
    expect(() => decrypt('AAAA', key)).toThrow(/invalid ciphertext/));
  it('rejects non-hex keys', () =>
    expect(() => encryptionKey('00'.repeat(32) + 'zz')).toThrow(/32 bytes/));
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
