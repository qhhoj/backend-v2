const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

/** Safe in element text and in a double-quoted attribute; an apostrophe stays as written. */
export const escapeHtml = (text: string): string =>
  text.replace(/[&<>"]/g, (character) => HTML_ENTITIES[character]);

const XML_ENTITIES: Record<string, string> = {
  ...HTML_ENTITIES,
  "'": '&apos;',
};
/** Characters XML 1.0 cannot carry at all (the `Char` production). */
const NOT_XML =
  // eslint-disable-next-line no-control-regex -- the control characters are the point
  /[^\u0009\u000A\u000D -퟿-�\u{10000}-\u{10FFFF}]/gu;

/** Safe in XML text and in either kind of quoted attribute; characters XML cannot carry are dropped. */
export const escapeXml = (text: string): string =>
  text
    .replace(NOT_XML, '')
    .replace(/[<>&'"]/g, (character) => XML_ENTITIES[character]);
