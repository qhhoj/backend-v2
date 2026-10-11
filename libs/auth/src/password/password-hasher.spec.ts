import fixtures from '../../../../test/fixtures/django.json';
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  needsRehash,
  verifyPassword,
} from './password-hasher';

const MALFORMED_HASHES = [
  '!unusable',
  '',
  'md5$salt$abc',
  'pbkdf2_sha256$abc$salt$hash',
  DUMMY_PASSWORD_HASH,
  `${fixtures.passwords[0].hash}$x`,
  'constructor$1$salt$AAAA',
  '__proto__$1$salt$AAAA',
  'toString$1$salt$AAAA',
  'pbkdf2_sha256$1$salt$!',
  'pbkdf2_sha256$2147483648$salt$AAAA',
  'pbkdf2_sha256$1e3$salt$AAAA',
  'pbkdf2_sha256$-1$salt$AAAA',
  'pbkdf2_sha256$1$salt$AA==',
];

describe('password hasher', () => {
  // The production cost, whatever an e2e file of this jest worker left in the environment.
  beforeAll(() => {
    delete process.env.TEST_PASSWORD_ITERATIONS;
  });
  it.each(fixtures.passwords)(
    'verifies Django hash for "$password"',
    async ({ password, hash }) => {
      expect(await verifyPassword(password, hash)).toBe(true);
      expect(await verifyPassword(`${password}!`, hash)).toBe(false);
    },
  );
  it('rejects unusable and malformed hashes', async () => {
    for (const encoded of MALFORMED_HASHES)
      expect(await verifyPassword('anything', encoded)).toBe(false);
  });
  it('hashes in Django format and round-trips', async () => {
    const encoded = await hashPassword('s3cret-pass', 1000);
    expect(encoded).toMatch(
      /^pbkdf2_sha256\$1000\$[A-Za-z0-9]{22}\$[A-Za-z0-9+/]{43}=$/,
    );
    expect(await verifyPassword('s3cret-pass', encoded)).toBe(true);
  });
  it('never accepts a digest shorter than the algorithm key length', async () => {
    const full = await hashPassword('secret-pass', 1);
    const [algorithm, iterations, salt, digest] = full.split('$');
    const truncated = [
      algorithm,
      iterations,
      salt,
      Buffer.from(digest, 'base64').subarray(0, 1).toString('base64'),
    ].join('$');
    for (let attempt = 0; attempt < 1500; attempt++)
      expect(await verifyPassword(`random-${attempt}`, truncated)).toBe(false);
  });
  it('flags weaker hashes for rehash', () => {
    expect(fixtures.passwords.map(({ hash }) => needsRehash(hash))).toEqual([
      false,
      true,
      true,
    ]);
  });
  it('flags a salt shorter than 22 characters for rehash', () => {
    const digest = 'A'.repeat(43) + '=';
    expect(
      needsRehash(`pbkdf2_sha256$870000$${'s'.repeat(12)}$${digest}`),
    ).toBe(true);
    expect(
      needsRehash(`pbkdf2_sha256$870000$${'s'.repeat(22)}$${digest}`),
    ).toBe(false);
  });
});
