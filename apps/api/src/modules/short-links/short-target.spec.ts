import { shortTargetOf } from './short-target';

describe('shortTargetOf', () => {
  it.each([
    '/problems/sum',
    '/problems/a_b9',
    '/contests/round_1',
    '/contests/round_1/ranking',
    '/contests/round_1/announcements',
    '/contests/round_1/submissions',
    '/contests/round_1/stats',
    '/blog/0190a000-0000-7000-8000-000000000001',
    '/users/alice',
    '/users/a.b-c@d+e',
    '/organizations/HCMUS_Informatics',
  ])('accepts the site path %s as it is', (path) => {
    expect(shortTargetOf(path)).toBe(path);
  });

  it.each([
    ['a protocol-relative URL', '//evil.example'],
    ['a protocol-relative URL with a path', '//evil.example/problems/sum'],
    ['a backslash host', '/\\evil.example'],
    ['an encoded slash pair', '/%2F%2Fevil.example'],
    ['an absolute https URL', 'https://evil.example'],
    [
      'an absolute URL to an allowed shape',
      'https://evil.example/problems/sum',
    ],
    ['a javascript URL', 'javascript:alert(1)'],
    ['a mixed-case javascript URL', 'JaVaScRiPt:alert(1)'],
    ['a data URL', 'data:text/html,hi'],
    ['a query string', '/problems/ok?next=//evil.example'],
    ['a fragment', '/problems/ok#frag'],
    ['an encoded CRLF', '/problems/ok%0d%0aSet-Cookie:x=1'],
    ['a raw CRLF', '/problems/ok\r\nSet-Cookie: x=1'],
    ['a trailing newline', '/problems/ok\n'],
    ['a traversal', '/problems/../admin'],
    ['an encoded traversal', '/problems/%2e%2e'],
    ['a missing code', '/problems/'],
    ['the list page', '/problems'],
    ['an upper-case problem code', '/problems/UPPER'],
    ['a trailing slash', '/contests/round_1/'],
    ['an unknown contest tab', '/contests/round_1/secret'],
    ['a deeper contest path', '/contests/round_1/ranking/x'],
    [
      'a blog path with a suffix',
      '/blog/0190a000-0000-7000-8000-000000000001/x',
    ],
    ['a nested users path', '/users/a/b'],
    ['a dot username', '/users/..'],
    ['a single-dot username', '/users/.'],
    ['a username with a space', '/users/a b'],
    ['an organization slug starting with a digit', '/organizations/1abc'],
    ['an admin page', '/admin'],
    ['an API path', '/api/internal/auth/me'],
    ['a path without the leading slash', 'problems/sum'],
    ['leading whitespace', ' /problems/sum'],
    ['trailing whitespace', '/problems/sum '],
    ['the empty string', ''],
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
