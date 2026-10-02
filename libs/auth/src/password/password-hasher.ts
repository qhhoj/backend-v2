import { pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const pbkdf2Async = promisify(pbkdf2);
const DIGESTS: Record<string, string> = {
  pbkdf2_sha256: 'sha256',
  pbkdf2_sha1: 'sha1',
};

export const PASSWORD_ITERATIONS = 870_000;
/** Well-formed hash no password matches; verifying against it keeps unknown-user logins as slow as real ones. */
export const DUMMY_PASSWORD_HASH = `pbkdf2_sha256$${PASSWORD_ITERATIONS}$dummysaltdummysaltdumm$${'A'.repeat(43)}=`;

export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const [algorithm, iterationText, salt, expectedText] = encoded.split('$');
  const iterations = Number(iterationText);
  if (
    !DIGESTS[algorithm] ||
    !Number.isInteger(iterations) ||
    iterations < 1 ||
    !salt ||
    !expectedText
  )
    return false;
  const expected = Buffer.from(expectedText, 'base64');
  const actual = await pbkdf2Async(
    password,
    salt,
    iterations,
    expected.length,
    DIGESTS[algorithm],
  );
  const isDummy = encoded === DUMMY_PASSWORD_HASH;
  return timingSafeEqual(actual, expected) && !isDummy;
}

export async function hashPassword(
  password: string,
  iterations = PASSWORD_ITERATIONS,
): Promise<string> {
  const salt = randomBytes(32)
    .toString('base64')
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 22);
  const hash = await pbkdf2Async(password, salt, iterations, 32, 'sha256');
  return `pbkdf2_sha256$${iterations}$${salt}$${hash.toString('base64')}`;
}

export function needsRehash(encoded: string): boolean {
  const [algorithm, iterations] = encoded.split('$');
  return (
    algorithm !== 'pbkdf2_sha256' || Number(iterations) < PASSWORD_ITERATIONS
  );
}
