import { textExcerpt } from './feed-xml';

/** Comment HTML up to this size goes into lists (home, feeds) whole. */
const LIST_HTML_BYTES = 32 * 1024;
const LIST_EXCERPT_LENGTH = 500;
/** KaTeX's MathML twin repeats the visible formula's text. */
const KATEX_MATHML = /<span class="katex-mathml">[\s\S]*?<\/math><\/span>/g;

/** A comment's sanitized HTML as a list carries it: whole when small, else a paragraph of its first words (tags dropped, entities kept), so one long comment never makes a list large. */
export const listHtml = (html: string): string =>
  Buffer.byteLength(html) <= LIST_HTML_BYTES
    ? html
    : `<p>${textExcerpt(html.replace(KATEX_MATHML, ''), LIST_EXCERPT_LENGTH)}</p>`;
