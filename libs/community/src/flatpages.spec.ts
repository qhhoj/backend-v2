import { normalizeFlatpageUrl } from './flatpages';

describe('normalizeFlatpageUrl', () => {
  it.each([
    ['about', '/about'],
    ['/about/', '/about'],
    ['help//faq', '/help/faq'],
    ['help/faq/', '/help/faq'],
  ])('maps %s to %s', (raw, canonical) => {
    expect(normalizeFlatpageUrl(raw)).toBe(canonical);
  });

  it.each([
    ['empty', ''],
    ['only slashes', '///'],
    ['a dot segment', 'a/./b'],
    ['a parent segment', 'a/../b'],
    ['a control character', 'a\u0000b'],
    ['too long', 'x'.repeat(201)],
  ])('refuses %s', (_name, raw) => {
    expect(normalizeFlatpageUrl(raw)).toBeNull();
  });
});
