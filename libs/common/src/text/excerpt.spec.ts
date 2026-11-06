import { excerpt } from './excerpt';

describe('excerpt', () => {
  it.each([
    ['a😀bc', 2, 'a😀'],
    ['ab', 200, 'ab'],
    ['abc', 0, ''],
    ['', 5, ''],
    ['abc', 3, 'abc'],
  ])('cuts %j to %i code points like a Python slice', (text, length, cut) =>
    expect(excerpt(text, length)).toBe(cut),
  );
});
