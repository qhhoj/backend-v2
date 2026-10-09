import { AuthFailures } from './auth-failures';

describe('AuthFailures', () => {
  let now: number;
  let failures: AuthFailures;
  beforeEach(() => {
    now = 0;
    failures = new AuthFailures(
      { maxPerWindow: 3, windowMs: 60_000 },
      () => now,
    );
  });

  it('locks an address out at the limit, not before, and not other addresses', () => {
    expect([failures.record('10.0.0.1'), failures.record('10.0.0.1')]).toEqual([
      1, 2,
    ]);
    expect(failures.isLocked('10.0.0.1')).toBe(false);
    expect(failures.record('10.0.0.1')).toBe(3);
    expect(failures.isLocked('10.0.0.1')).toBe(true);
    expect(failures.isLocked('10.0.0.2')).toBe(false);
  });

  it('lets the address in again when its window ends, and counts from one', () => {
    for (let attempt = 0; attempt < 3; attempt += 1)
      failures.record('10.0.0.1');
    now = 59_999;
    expect(failures.isLocked('10.0.0.1')).toBe(true);
    now = 60_000;
    expect(failures.isLocked('10.0.0.1')).toBe(false);
    expect(failures.record('10.0.0.1')).toBe(1);
  });

  it('counts failures across a window from its first failure, not a sliding one', () => {
    failures.record('10.0.0.1');
    now = 50_000;
    failures.record('10.0.0.1');
    now = 60_000;
    expect(failures.record('10.0.0.1')).toBe(1);
  });
});
