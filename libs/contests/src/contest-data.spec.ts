import { newId } from '@libs/database';
import {
  canPrepareData,
  contestDataPath,
  contestDataTempPath,
  matchesGlob,
  PROBLEM_GLOB_PATTERN,
} from './contest-data';

describe('contest data paths', () => {
  it('builds paths inside the root from a contest id only', () => {
    const id = newId();
    expect(contestDataPath('/srv/data', id)).toBe(`/srv/data/${id}.zip`);
    expect(contestDataTempPath('/srv/data', id)).toBe(
      `/srv/data/${id}.zip.tmp`,
    );
    expect(() => contestDataPath('/srv/data', '../etc/passwd')).toThrow();
  });

  it('allows a new prepare when never prepared, after 24 hours, or when the zip is missing', () => {
    const now = new Date('2026-01-02T00:00:00Z');
    expect(canPrepareData(null, true, now)).toBe(true);
    expect(canPrepareData(new Date('2026-01-01T00:00:01Z'), true, now)).toBe(
      false,
    );
    expect(canPrepareData(new Date('2026-01-01T00:00:01Z'), false, now)).toBe(
      true,
    );
    expect(canPrepareData(new Date('2026-01-01T00:00:00Z'), true, now)).toBe(
      false,
    );
    expect(canPrepareData(new Date('2025-12-31T23:59:59Z'), true, now)).toBe(
      true,
    );
  });
});

describe('matchesGlob', () => {
  it.each([
    ['*', 'anything', true],
    ['sum*', 'sum_2', true],
    ['sum*', 'asum', false],
    ['?b', 'ab', true],
    ['?b', 'abb', false],
    ['a*b*c', 'a_x_b_y_c', true],
    ['a*b*c', 'a_x_c_y_b', false],
    ['a**c', 'abc', true],
  ])('%s against %s is %s', (glob, code, expected) =>
    expect(matchesGlob(glob, code)).toBe(expected),
  );

  it('stays linear on a pathological glob', () => {
    const started = Date.now();
    expect(matchesGlob(`${'*a'.repeat(49)}b`, 'a'.repeat(32))).toBe(false);
    expect(Date.now() - started).toBeLessThan(50);
  });
});

describe('PROBLEM_GLOB_PATTERN', () => {
  it.each([
    ['sum_*', true],
    ['a?c', true],
    ['*', true],
    ['../x', false],
    ['Sum', false],
    ['a[bc]', false],
    ['', false],
    ['a'.repeat(101), false],
  ])('%s is accepted: %s', (glob, accepted) =>
    expect(PROBLEM_GLOB_PATTERN.test(glob)).toBe(accepted),
  );
});
