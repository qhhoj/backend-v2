import { randomBytes } from 'node:crypto';
import { newId } from '@libs/database';
import { apiTokenMatches, generateApiToken, parseApiToken } from './api-token';

const tokenSecret = 'test-token-secret-test-token-secret';
const tokenFor = (idHex: string) =>
  Buffer.concat([Buffer.from(idHex, 'hex'), randomBytes(32)]).toString(
    'base64url',
  );

describe('api tokens', () => {
  it('round-trips user id and verifies against the stored hash', () => {
    const userId = newId();
    const { token, hash } = generateApiToken(userId, tokenSecret);
    expect(token).toMatch(/^[A-Za-z0-9_-]{64}$/);
    const parsed = parseApiToken(token)!;
    expect(parsed.userId).toBe(userId);
    expect(apiTokenMatches(parsed.secret, hash, tokenSecret)).toBe(true);
    expect(
      apiTokenMatches(
        parsed.secret,
        hash,
        'other-secret-other-secret-other-se',
      ),
    ).toBe(false);
    expect(apiTokenMatches(parsed.secret, null, tokenSecret)).toBe(false);
  });
  it('rejects the secret of one token against the hash of another', () => {
    const first = generateApiToken(newId(), tokenSecret);
    const second = generateApiToken(newId(), tokenSecret);
    expect(
      apiTokenMatches(
        parseApiToken(first.token)!.secret,
        second.hash,
        tokenSecret,
      ),
    ).toBe(false);
  });
  it('issues a different secret every time', () => {
    const userId = newId();
    expect(generateApiToken(userId, tokenSecret).hash).not.toBe(
      generateApiToken(userId, tokenSecret).hash,
    );
  });
  it.each([
    '',
    'short',
    'A'.repeat(63),
    `${'A'.repeat(63)}=`,
    'a+b/'.repeat(16),
  ])('rejects malformed token %p', (token) =>
    expect(parseApiToken(token)).toBeNull(),
  );
  it.each([
    ['version 4', '0190a5c4e1b24c3a8d5e1f2a3b4c5d6e'],
    ['wrong variant', '0190a5c4e1b27c3ac0de1f2a3b4c5d6e'],
    ['all zero', '00000000000000000000000000000000'],
  ])('rejects a token whose id is not a UUID v7 (%s)', (_label, idHex) =>
    expect(parseApiToken(tokenFor(idHex))).toBeNull(),
  );
  it('rejects a stored hash of the wrong length', () => {
    const { token } = generateApiToken(newId(), tokenSecret);
    expect(
      apiTokenMatches(parseApiToken(token)!.secret, 'abcd', tokenSecret),
    ).toBe(false);
  });
  it.each([
    'z'.repeat(64),
    'G'.repeat(64),
    `${'a'.repeat(63)}Z`,
    'A'.repeat(64),
  ])('never throws on a non-lowercase-hex stored hash %p', (stored) => {
    const { token } = generateApiToken(newId(), tokenSecret);
    expect(
      apiTokenMatches(parseApiToken(token)!.secret, stored, tokenSecret),
    ).toBe(false);
  });
});
