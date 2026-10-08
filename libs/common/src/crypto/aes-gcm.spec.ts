import { decrypt, encrypt, encryptionKey } from './aes-gcm';

const key = encryptionKey(
  '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
);

describe('aes-gcm', () => {
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
});
