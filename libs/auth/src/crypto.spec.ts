import { constantTimeEqual } from './crypto';

describe('crypto', () => {
  it('compares strings in constant time and rejects non-strings', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    for (const given of ['abd', 'ab', 'abcd', '', undefined, 123, ['abc']])
      expect(constantTimeEqual(given, 'abc')).toBe(false);
  });
});
