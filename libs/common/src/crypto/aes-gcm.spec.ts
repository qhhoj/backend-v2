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
  it('rejects blobs too short to hold the IV and tag', () =>
    expect(() => decrypt('AAAA', key)).toThrow(/invalid ciphertext/));
  it.each(['abcd', '00'.repeat(32) + 'zz'])('rejects bad key %s', (bad) =>
    expect(() => encryptionKey(bad)).toThrow(/32 bytes/),
  );
});
