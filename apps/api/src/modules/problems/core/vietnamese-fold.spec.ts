import { diacriticInsensitivePattern } from './vietnamese-fold';

const matches = (word: string, text: string) =>
  new RegExp(diacriticInsensitivePattern(word), 'i').test(text);

describe('diacriticInsensitivePattern', () => {
  it('matches accented letters from plain input', () => {
    expect(matches('xep', 'Xếp hàng')).toBe(true);
    expect(matches('luc giac', 'Đại Sảnh Lục Giác')).toBe(true);
    expect(matches('dai', 'ĐẠI SẢNH')).toBe(true);
  });
  it('matches plain text from accented input', () => {
    expect(matches('Xếp', 'xep hang')).toBe(true);
    expect(matches('đại', 'DAI')).toBe(true);
  });
  it('matches inside a code', () => {
    expect(matches('hexagon', 'qhh_hexagonhall')).toBe(true);
    expect(matches('qhh_xep', 'qhh_xepbiv2')).toBe(true);
  });
  it('does not match unrelated text', () => {
    expect(matches('xep', 'xe bus')).toBe(false);
    expect(matches('a', 'b')).toBe(false);
  });
  it('treats regex specials as literals', () => {
    expect(matches('c++', 'C++ tricks')).toBe(true);
    expect(matches('.*', 'abc')).toBe(false);
    expect(matches('a(', 'a(b')).toBe(true);
  });
});
