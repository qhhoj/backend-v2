import { jsRegex } from './navigation-regex';

describe('jsRegex', () => {
  it('keeps a compiling pattern', () =>
    expect(jsRegex('^/problem')).toEqual({
      regex: '^/problem',
      converted: false,
    }));
  it('converts Python verbose patterns and named groups', () =>
    expect(jsRegex('(?x) ^/submission (?P<id>\\d+)  # list')).toEqual({
      regex: '^/submission(?<id>\\d+)',
      converted: true,
    }));
  it('keeps whitespace and # of a non-verbose pattern', () =>
    expect(jsRegex('^/a b#c(?P<x>d)')).toEqual({
      regex: '^/a b#c(?<x>d)',
      converted: true,
    }));
  it('gives up on what still does not compile', () =>
    expect(jsRegex('(?P<x>a')).toBeNull());
});
