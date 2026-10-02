import fixtures from '../../../../test/fixtures/django.json';
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  needsRehash,
  verifyPassword,
} from './password-hasher';

describe('password hasher', () => {
  it.each(fixtures.passwords)(
    'verifies Django hash for "$password"',
    async ({ password, hash }) => {
      expect(await verifyPassword(password, hash)).toBe(true);
      expect(await verifyPassword(`${password}!`, hash)).toBe(false);
    },
  );
  it('rejects unusable and malformed hashes', async () => {
    for (const encoded of [
      '!unusable',
      '',
      'md5$salt$abc',
      'pbkdf2_sha256$abc$salt$hash',
      DUMMY_PASSWORD_HASH,
    ])
      expect(await verifyPassword('anything', encoded)).toBe(false);
  });
  it('hashes in Django format and round-trips', async () => {
    const encoded = await hashPassword('s3cret-pass', 1000);
    expect(encoded).toMatch(
      /^pbkdf2_sha256\$1000\$[A-Za-z0-9]{22}\$[A-Za-z0-9+/]{43}=$/,
    );
    expect(await verifyPassword('s3cret-pass', encoded)).toBe(true);
  });
  it('flags weaker hashes for rehash', () => {
    expect(fixtures.passwords.map(({ hash }) => needsRehash(hash))).toEqual([
      false,
      true,
      true,
    ]);
  });
});
