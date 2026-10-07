import { excerpt } from '@libs/community';

export interface FeedChannel {
  title: string;
  link: string;
  selfLink: string;
  description: string;
  /** Atom requires an author on the feed or on every entry. */
  author: string;
}

export interface FeedItem {
  id: string;
  title: string;
  link: string;
  published: Date;
  /** Sanitized HTML, sent escaped (`description`, Atom `summary type="html"`). */
  html: string;
}

const ENTITIES: Record<string, string> = {
  '<': '&lt;',
  '>': '&gt;',
  '&': '&amp;',
  "'": '&apos;',
  '"': '&quot;',
};
/** Characters XML 1.0 cannot carry at all (the `Char` production). */
const NOT_XML =
  // eslint-disable-next-line no-control-regex -- the control characters are the point
  /[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu;

export const escapeXml = (text: string): string =>
  text
    .replace(NOT_XML, '')
    .replace(/[<>&'"]/g, (character) => ENTITIES[character]);

const element = (name: string, text: string) =>
  `<${name}>${escapeXml(text)}</${name}>`;
const HEADER = '<?xml version="1.0" encoding="utf-8"?>\n';

export function rssFeed(
  channel: FeedChannel,
  items: readonly FeedItem[],
): string {
  const entries = items.map(
    (item) =>
      `<item>${element('title', item.title)}${element('link', item.link)}${element('description', item.html)}` +
      `<guid isPermaLink="false">${escapeXml(item.id)}</guid>${element('pubDate', item.published.toUTCString())}</item>`,
  );
  return (
    `${HEADER}<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>` +
    `${element('title', channel.title)}${element('link', channel.link)}${element('description', channel.description)}` +
    `<atom:link href="${escapeXml(channel.selfLink)}" rel="self"/>${entries.join('')}</channel></rss>`
  );
}

export function atomFeed(
  channel: FeedChannel,
  items: readonly FeedItem[],
): string {
  const updated = new Date(
    Math.max(0, ...items.map((item) => item.published.getTime())),
  );
  const entries = items.map(
    (item) =>
      `<entry>${element('title', item.title)}<link href="${escapeXml(item.link)}" rel="alternate"/>` +
      `<id>urn:uuid:${escapeXml(item.id)}</id>${element('published', item.published.toISOString())}` +
      `${element('updated', item.published.toISOString())}<summary type="html">${escapeXml(item.html)}</summary></entry>`,
  );
  return (
    `${HEADER}<feed xmlns="http://www.w3.org/2005/Atom">${element('title', channel.title)}` +
    `${element('subtitle', channel.description)}<link href="${escapeXml(channel.link)}" rel="alternate"/>` +
    `<link href="${escapeXml(channel.selfLink)}" rel="self"/>${element('id', channel.selfLink)}` +
    `${element('updated', updated.toISOString())}<author>${element('name', channel.author)}</author>${entries.join('')}</feed>`
  );
}

/** Rendered HTML to at most `length` code points of text (legacy problem feed cut the statement at 500). */
export const textExcerpt = (html: string, length: number): string =>
  excerpt(
    html
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
    length,
  );
