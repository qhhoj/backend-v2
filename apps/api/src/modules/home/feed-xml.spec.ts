import { atomFeed, escapeXml, rssFeed, textExcerpt } from './feed-xml';

describe('feed XML', () => {
  const channel = {
    title: 'Latest QHHOJ Blog Posts',
    link: 'https://oj.example/',
    selfLink: 'https://oj.example/feed/blog/rss/',
    description: 'The latest blog posts',
    author: 'QHHOJ',
  };
  const items = [
    {
      id: '0199a000-0000-7000-8000-000000000001',
      title: 'A & B <x>',
      link: 'https://oj.example/post/1',
      published: new Date('2026-10-07T10:00:00Z'),
      html: '<p>Hi "you"</p>',
    },
    {
      id: '0199a000-0000-7000-8000-000000000002',
      title: 'Older',
      link: 'https://oj.example/post/2',
      published: new Date('2026-10-06T10:00:00Z'),
      html: '<p>Old</p>',
    },
  ];

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

  it('writes RSS 2.0 with escaped HTML descriptions, guids and RFC 822 dates', () => {
    const xml = rssFeed(channel, items);
    expect(xml).toMatch(
      /^<\?xml version="1.0" encoding="utf-8"\?>\n<rss version="2.0"/,
    );
    expect(xml).toContain('<title>A &amp; B &lt;x&gt;</title>');
    expect(xml).toContain(
      '<description>&lt;p&gt;Hi &quot;you&quot;&lt;/p&gt;</description>',
    );
    expect(xml).toContain(`<guid isPermaLink="false">${items[0].id}</guid>`);
    expect(xml).toContain('<pubDate>Wed, 07 Oct 2026 10:00:00 GMT</pubDate>');
    expect(xml).toContain(
      '<atom:link href="https://oj.example/feed/blog/rss/" rel="self"',
    );
    expect(xml.indexOf(items[0].id)).toBeLessThan(xml.indexOf(items[1].id));
  });

  it('writes Atom 1.0 updated at the newest entry', () => {
    const xml = atomFeed(channel, items);
    expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
    expect(xml).toContain('<updated>2026-10-07T10:00:00.000Z</updated>');
    expect(xml).toContain('<author><name>QHHOJ</name></author>');
    expect(xml).toContain(`<id>urn:uuid:${items[1].id}</id>`);
    expect(xml).toContain(
      '<summary type="html">&lt;p&gt;Old&lt;/p&gt;</summary>',
    );
    expect(atomFeed(channel, [])).toContain(
      '<updated>1970-01-01T00:00:00.000Z</updated>',
    );
  });

  it('reduces HTML to a plain-text excerpt', () => {
    expect(textExcerpt('<p>Sum <strong>a</strong>\n\n+ b</p>', 9)).toBe(
      'Sum a + b',
    );
    expect(textExcerpt('<p>abcdef</p>', 3)).toBe('abc');
  });
});
