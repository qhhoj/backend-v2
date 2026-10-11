import { shortTargetOf } from './short-target';

describe('shortTargetOf', () => {
  it.each([
    '/problems/sum',
    '/contests/round_1',
    '/contests/round_1/ranking',
    '/blog/0190a000-0000-7000-8000-000000000001',
    '/users/alice',
    '/organizations/HCMUS_Informatics',
  ])('accepts the site path %s as it is', (path) => {
    expect(shortTargetOf(path)).toBe(path);
  });

  it.each([
    ['a protocol-relative URL', '//evil.example'],
    ['a backslash host', '/\\evil.example'],
    ['an encoded slash pair', '/%2F%2Fevil.example'],
    [
      'an absolute URL to an allowed shape',
      'https://evil.example/problems/sum',
    ],
    ['a javascript URL', 'javascript:alert(1)'],
    ['a query string', '/problems/ok?next=//evil.example'],
    ['an encoded CRLF', '/problems/ok%0d%0aSet-Cookie:x=1'],
    ['a traversal', '/problems/../admin'],
    ['a missing code', '/problems/'],
    ['an upper-case problem code', '/problems/UPPER'],
    ['an unknown contest tab', '/contests/round_1/secret'],
    [
      'a blog path with a suffix',
      '/blog/0190a000-0000-7000-8000-000000000001/x',
    ],
    ['a dot username', '/users/..'],
    ['an organization slug starting with a digit', '/organizations/1abc'],
    ['an admin page', '/admin'],
    ['a path past the length limit', `/users/${'a'.repeat(300)}`],
  ])('refuses %s', (_name, path) => {
    expect(shortTargetOf(path)).toBeNull();
  });

  it.each([null, undefined, 42, {}, ['/problems/sum']])(
    'refuses the non-string %p',
    (value) => {
      expect(shortTargetOf(value)).toBeNull();
    },
  );
});
