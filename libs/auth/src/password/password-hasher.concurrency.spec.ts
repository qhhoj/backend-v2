import {
  hashPassword,
  MAX_HASH_WAIT_MS,
  MAX_HASHES_PER_REQUESTER,
  verifyPassword,
} from './password-hasher';

let mockRunning = 0;
let mockMostAtOnce = 0;
/** Derivations held until the test finishes them (`null`: each finishes after 5 ms). */
let mockHeld: Array<() => void> | null = null;
/** The password of each derivation, in the order they started. */
let mockStarted: string[] = [];
// A fake PBKDF2 that records how many derivations overlap.
jest.mock('node:crypto', () => ({
  ...jest.requireActual<typeof import('node:crypto')>('node:crypto'),
  pbkdf2: (...args: unknown[]) => {
    mockRunning++;
    mockStarted.push(String(args[0]));
    mockMostAtOnce = Math.max(mockMostAtOnce, mockRunning);
    const finish = () => {
      mockRunning--;
      (args[5] as (error: null, key: Buffer) => void)(null, Buffer.alloc(32));
    };
    if (mockHeld) mockHeld.push(finish);
    else setTimeout(finish, 5);
  },
}));

describe('password hashing concurrency', () => {
  afterEach(() => {
    jest.useRealTimers();
    mockHeld = null;
    mockStarted = [];
  });
  const settle = () => new Promise((resolve) => setImmediate(resolve));

  it('runs at most two derivations at once, whatever the number of callers', async () => {
    const checks = Array.from({ length: 6 }, (_unused, index) =>
      index % 2
        ? hashPassword('a password')
        : verifyPassword('a password', '!unusable'),
    );
    await Promise.all(checks);
    expect(mockMostAtOnce).toBe(2);
  });

  it('refuses a check that waited too long for a slot with 429 and Retry-After, and still runs the others', async () => {
    jest.useFakeTimers();
    mockHeld = [];
    const running = [1, 2].map(() => hashPassword('a password'));
    const waiting = verifyPassword('a password', '!unusable');
    const refused = expect(waiting).rejects.toMatchObject({
      status: 429,
      headers: { 'Retry-After': '20' },
    });
    jest.advanceTimersByTime(MAX_HASH_WAIT_MS);
    await refused;
    for (const finish of mockHeld) finish();
    await expect(Promise.all(running)).resolves.toHaveLength(2);
  });

  it('serves requesters in turn and refuses one requester its checks beyond its share before hashing', async () => {
    mockHeld = [];
    const flood = Array.from({ length: 300 }, () =>
      verifyPassword('flood', '!unusable', '203.0.113.66').then(
        () => 'checked',
        () => 'refused',
      ),
    );
    await settle();
    const bystander = verifyPassword('bystander', '!unusable', '192.0.2.200');
    await settle();
    for (const finish of mockHeld.splice(0, 2)) finish();
    await settle();
    expect(mockStarted).toContain('bystander');
    while (mockHeld.length) {
      mockHeld.shift()!();
      await settle();
    }
    await expect(bystander).resolves.toBe(false);
    const outcomes = await Promise.all(flood);
    expect(outcomes.filter((outcome) => outcome === 'checked')).toHaveLength(
      MAX_HASHES_PER_REQUESTER,
    );
  });
});
