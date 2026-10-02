import { DUMMY_PASSWORD_HASH, verifyPassword } from './password-hasher';

// Force every derived key to be 32 zero bytes, which is exactly the digest the dummy hash encodes.
jest.mock('node:crypto', () => ({
  ...jest.requireActual<typeof import('node:crypto')>('node:crypto'),
  pbkdf2: (...args: unknown[]) =>
    (args[5] as (error: null, key: Buffer) => void)(null, Buffer.alloc(32)),
}));

describe('dummy password hash guard', () => {
  it('rejects the dummy hash even when the derived key equals its digest', async () => {
    expect(await verifyPassword('anything', DUMMY_PASSWORD_HASH)).toBe(false);
  });
  it('still accepts an otherwise identical hash with another salt', async () => {
    expect(
      await verifyPassword(
        'anything',
        DUMMY_PASSWORD_HASH.replace('dummysalt', 'othersalt'),
      ),
    ).toBe(true);
  });
});
