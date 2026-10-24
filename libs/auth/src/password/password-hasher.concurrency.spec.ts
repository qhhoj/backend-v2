import { hashPassword, verifyPassword } from './password-hasher';

let mockRunning = 0;
let mockMostAtOnce = 0;
// A slow fake PBKDF2 that records how many derivations overlap.
jest.mock('node:crypto', () => ({
  ...jest.requireActual<typeof import('node:crypto')>('node:crypto'),
  pbkdf2: (...args: unknown[]) => {
    mockRunning++;
    mockMostAtOnce = Math.max(mockMostAtOnce, mockRunning);
    setTimeout(() => {
      mockRunning--;
      (args[5] as (error: null, key: Buffer) => void)(null, Buffer.alloc(32));
    }, 5);
  },
}));

describe('password hashing concurrency', () => {
  it('runs at most two derivations at once, whatever the number of callers', async () => {
    const checks = Array.from({ length: 6 }, (_unused, index) =>
      index % 2
        ? hashPassword('a password')
        : verifyPassword('a password', '!unusable'),
    );
    await Promise.all(checks);
    expect(mockMostAtOnce).toBe(2);
  });
});
