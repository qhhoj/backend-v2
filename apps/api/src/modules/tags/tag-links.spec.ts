import { parseProblemLink } from './tag-links';

describe('parseProblemLink', () => {
  it.each([
    ['https://codeforces.com/problemset/problem/1/A', 'CF_1_A', 'Codeforces'],
    [
      'https://codeforces.com/contest/1234/problem/B2',
      'CF_1234_B2',
      'Codeforces',
    ],
    [
      'https://codeforces.com/gym/102951/problem/C',
      'CFGYM_102951_C',
      'CodeforcesGym',
    ],
    [
      'https://atcoder.jp/contests/abc001/tasks/abc001_a',
      'AC_abc001_a',
      'Atcoder',
    ],
    ['https://oj.vnoi.info/problem/post', 'VNOJ_post', 'VNOJ'],
    ['https://open.kattis.com/problems/hello', 'KATTIS_hello', 'Kattis'],
  ])('maps %s to %s on %s', (link, code, judge) =>
    expect(parseProblemLink(link)).toEqual({ code, judge }),
  );
  it.each([
    'http://codeforces.com/problemset/problem/1/A',
    'https://codeforces.com/problemset/problem/1/A/',
    'https://example.com/p/1',
    'https://codeforces.com/problemset/problem/1/A?x=1',
  ])('rejects %s', (link) => expect(parseProblemLink(link)).toBeNull());
});
