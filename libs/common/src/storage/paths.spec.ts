import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isInside, isInsideReal, resolveInside } from './paths';

describe('isInside', () => {
  it.each([
    ['/data/a', '/data/a/b', true],
    ['/data/a', '/data/a', true],
    ['/data/a', '/data/a/..cache', true],
    ['/data/a', '/data/ab', false],
    ['/data/a', '/data/a/../b', false],
    ['/data/a', '/other', false],
  ])('root %s, path %s: %s', (root, path, inside) =>
    expect(isInside(root, path)).toBe(inside),
  );
});

describe('resolveInside', () => {
  it('returns paths strictly below the root', () =>
    expect(resolveInside('/data/a', 'x/y.txt', 'ROOT')).toBe(
      '/data/a/x/y.txt',
    ));

  it.each(['../b', '../ab/x', '/etc/passwd', '.', ''])(
    'refuses %j',
    (relative) =>
      expect(() => resolveInside('/data/a', relative, 'ROOT')).toThrow(
        `Path escapes ROOT: ${relative}`,
      ),
  );
});

describe('isInsideReal', () => {
  const base = mkdtempSync(join(tmpdir(), 'qhhoj-paths-'));
  const root = join(base, 'root');
  const outside = join(base, 'outside');
  mkdirSync(root);
  mkdirSync(outside);
  symlinkSync(outside, join(root, 'link'));
  afterAll(() => rmSync(base, { recursive: true, force: true }));

  it('follows a symlinked directory out of the root', () =>
    expect(isInsideReal(root, join(root, 'link', 'f'))).toBe(false));

  it('accepts a path that does not exist yet below the root', () =>
    expect(isInsideReal(root, join(root, 'new', 'deep', 'f'))).toBe(true));

  it('refuses a sibling whose name starts with the root name', () =>
    expect(isInsideReal(root, `${root}2/f`)).toBe(false));
});
