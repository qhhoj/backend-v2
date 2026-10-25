import { pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { AppError } from '@libs/common';
import { concurrencyLimit } from './concurrency-limit';
import type { Lane } from './concurrency-limit';

/** PBKDF2 runs on libuv's pool (4 threads by default), shared with file, DNS and zlib work, on a host with 2 cores outside judging: password checks never take more than half of it. */
const MAX_CONCURRENT_HASHES = 2;
/** A check still waiting for a slot after this long is refused, well inside nginx's 60 s proxy timeout. */
export const MAX_HASH_WAIT_MS = 20_000;
/** Checks one requester (a client address) may have running or waiting; more are refused at once, before any hashing. Matches nginx's `limit_conn qhhoj_login 8`. */
export const MAX_HASHES_PER_REQUESTER = 8;
const busy = () =>
  new AppError(
    'rate_limited',
    429,
    'Too many password checks at once; try again shortly',
    undefined,
    { 'Retry-After': String(MAX_HASH_WAIT_MS / 1000) },
  );
const withHashSlot = concurrencyLimit(
  {
    slots: MAX_CONCURRENT_HASHES,
    perLane: MAX_HASHES_PER_REQUESTER,
    maxWaitMs: MAX_HASH_WAIT_MS,
  },
  busy,
);
const derive = promisify(pbkdf2);
const pbkdf2Async = (
  lane: Lane | undefined,
  ...args: Parameters<typeof derive>
) => withHashSlot(() => derive(...args), lane);
const ALGORITHMS = new Map([
  ['pbkdf2_sha256', { digest: 'sha256', keyLength: 32 }],
  ['pbkdf2_sha1', { digest: 'sha1', keyLength: 20 }],
]);
const MAX_ITERATIONS = 2_147_483_647;
const MIN_SALT_LENGTH = 22;

export const PASSWORD_ITERATIONS = 870_000;

/** The cost of a new hash and the floor below which a login rehashes: `PASSWORD_ITERATIONS`, unless a jest run sets `TEST_PASSWORD_ITERATIONS` (ignored outside jest) so e2e logins skip the 870k rounds. */
export function passwordIterations(): number {
  const override = Number(process.env.TEST_PASSWORD_ITERATIONS);
  return process.env.JEST_WORKER_ID && override > 0
    ? override
    : PASSWORD_ITERATIONS;
}
const DUMMY_SALT = 'dummysaltdummysaltdumm';
/** Well-formed hash no password matches; verifying against it keeps unknown-user logins as slow as real ones. */
export const DUMMY_PASSWORD_HASH = `pbkdf2_sha256$${PASSWORD_ITERATIONS}$${DUMMY_SALT}$${'A'.repeat(43)}=`;

/**
 * `requester` (a client address) queues the check in that requester's lane: slots go to the lanes in turn, and a
 * requester holding `MAX_HASHES_PER_REQUESTER` checks is refused (429) at once. Without it the check has a lane of its own.
 */
export async function verifyPassword(
  password: string,
  encoded: string,
  requester?: string,
): Promise<boolean> {
  const [algorithmName, iterationText, salt, expectedText, ...extra] =
    encoded.split('$');
  const algorithm = ALGORITHMS.get(algorithmName);
  const iterations = Number(iterationText);
  if (
    extra.length ||
    !algorithm ||
    !/^\d+$/.test(iterationText) ||
    iterations < 1 ||
    iterations > MAX_ITERATIONS ||
    !salt ||
    !expectedText
  ) {
    // Unusable or malformed hash (e.g. Django "!..."): burn the same work as a real check so timing does not reveal it.
    await pbkdf2Async(
      requester,
      password,
      DUMMY_SALT,
      passwordIterations(),
      32,
      'sha256',
    );
    return false;
  }
  const expected = Buffer.from(expectedText, 'base64');
  const actual = await pbkdf2Async(
    requester,
    password,
    salt,
    iterations,
    algorithm.keyLength,
    algorithm.digest,
  );
  const isDummy = encoded === DUMMY_PASSWORD_HASH;
  return (
    expected.length === algorithm.keyLength &&
    timingSafeEqual(actual, expected) &&
    !isDummy
  );
}

export async function hashPassword(
  password: string,
  iterations = passwordIterations(),
): Promise<string> {
  const salt = randomBytes(32)
    .toString('base64')
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 22);
  const hash = await pbkdf2Async(
    undefined,
    password,
    salt,
    iterations,
    32,
    'sha256',
  );
  return `pbkdf2_sha256$${iterations}$${salt}$${hash.toString('base64')}`;
}

export function needsRehash(encoded: string): boolean {
  const [algorithm, iterations, salt = ''] = encoded.split('$');
  return (
    algorithm !== 'pbkdf2_sha256' ||
    Number(iterations) < passwordIterations() ||
    salt.length < MIN_SALT_LENGTH
  );
}
