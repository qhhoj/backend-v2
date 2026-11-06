import { escapeHtml, escapeXml } from './escape';

describe('escapeHtml', () => {
  it('escapes markup and double quotes, and leaves an apostrophe alone', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      `&lt;a href=&quot;x&quot;&gt;'&amp;'&lt;/a&gt;`,
    );
  });
});

describe('escapeXml', () => {
  it('escapes markup and drops characters XML cannot carry', () => {
    expect(escapeXml(`<a href="x">'&'</a>\u0000\u0008ok`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;ok',
    );
  });

  it('keeps astral characters and drops lone surrogates and U+FFFE', () => {
    expect(escapeXml('a\u{1F600}b\uD800c￾d\u0009e')).toBe(
      'a\u{1F600}bcd\u0009e',
    );
  });
});
