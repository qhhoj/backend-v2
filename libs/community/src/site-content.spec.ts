import {
  createsCycle,
  isSafeNavigationPath,
  isValidNavigationRegex,
} from './site-content';

describe('isValidNavigationRegex', () => {
  it.each([
    ['', true],
    ['^/problems', true],
    ['^/(a|b)/\\d+$', true],
    ['(', false],
    ['[', false],
    ['*a', false],
    ['x'.repeat(500), true],
    ['x'.repeat(501), false],
  ])('%s -> %s', (source, expected) => {
    expect(isValidNavigationRegex(source)).toBe(expected);
  });
});

describe('isSafeNavigationPath', () => {
  it.each([
    ['/', true],
    ['/problems?x=1', true],
    ['https://example.com/a', true],
    ['http://example.com', true],
    ['javascript:alert(1)', false],
    ['data:text/html,x', false],
    ['//evil.example', false],
    ['problems', false],
    ['', false],
    ['/a b', false],
    ['/a\nb', false],
  ])('%s -> %s', (path, expected) => {
    expect(isSafeNavigationPath(path)).toBe(expected);
  });
});

describe('createsCycle', () => {
  const parentOf = new Map<string, string | null>([
    ['root', null],
    ['child', 'root'],
    ['grandchild', 'child'],
    ['other', null],
  ]);

  it.each([
    ['itself', 'root', 'root', true],
    ['its child', 'root', 'child', true],
    ['its grandchild', 'root', 'grandchild', true],
    ['an unrelated root', 'root', 'other', false],
    ['its own parent (unchanged)', 'child', 'root', false],
    ['a sibling branch', 'grandchild', 'other', false],
  ])('%s', (_name, id, newParentId, expected) => {
    expect(createsCycle(parentOf, id, newParentId)).toBe(expected);
  });

  it('terminates on pre-existing corrupt loops that do not include the entry', () => {
    const loop = new Map<string, string | null>([
      ['a', 'b'],
      ['b', 'a'],
      ['c', null],
    ]);
    expect(createsCycle(loop, 'c', 'a')).toBe(false);
  });
});
