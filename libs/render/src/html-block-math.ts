import { findDollarMath, findTildeMath, isEscaped } from './math';

/** KaTeX HTML for one formula found in raw HTML (the caller applies the render budget and the blog style's deferral). */
export type RenderFormula = (tex: string, displayMode: boolean) => string;

/** A comment or a start/end tag; the text between two tags is element text. */
interface Tag {
  index: number;
  text: string;
}

/** End (exclusive) of the comment opening at `start`, or -1 when no `-->` follows. */
function commentEnd(html: string, start: number): number {
  const close = html.indexOf('-->', start + 4);
  return close < 0 ? -1 : close + 3;
}

/**
 * End (exclusive) of the start or end tag opening at `start`, or -1 when it never closes. A quoted attribute value may hold `>`;
 * an unclosed quote fails the tag. `walked` marks every position a scan passed outside quotes: scans start after the last tag
 * found, so a scan reaching a marked position follows a scan that failed from there, and fails too. Each position is walked
 * once, which keeps a whole block linear (a regex retrying every `<` was quadratic: a 200 KB post blocked the process for seconds).
 */
function tagEnd(html: string, start: number, walked: Uint8Array): number {
  let pos = start + (html[start + 1] === '/' ? 2 : 1);
  if (!/[A-Za-z]/.test(html[pos] ?? '')) return -1;
  for (; pos < html.length; pos++) {
    if (walked[pos]) return -1;
    walked[pos] = 1;
    const char = html[pos];
    if (char === '>') return pos + 1;
    if (char === '"' || char === "'") {
      pos = html.indexOf(char, pos + 1);
      if (pos < 0) return -1;
    }
  }
  return -1;
}

/** The comments and tags of raw HTML in order, in linear time. */
function* tagsOf(html: string): Generator<Tag> {
  const walked = new Uint8Array(html.length);
  let commentsClose = true;
  let start = html.indexOf('<');
  while (start >= 0) {
    const isComment = html.startsWith('<!--', start);
    const end = !isComment
      ? tagEnd(html, start, walked)
      : commentsClose
        ? commentEnd(html, start)
        : -1;
    // No `-->` after this comment means none after a later one either.
    if (isComment && end < 0) commentsClose = false;
    if (end >= 0) yield { index: start, text: html.slice(start, end) };
    start = html.indexOf('<', end >= 0 ? end : start + 1);
  }
}
/** Elements whose text is never math (the old site's MathJax skipped them too). */
const LITERAL_ELEMENT = /^<(\/?)(?:pre|code|script|style|textarea)\b/i;
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
};

/** HTML text as the TeX a reader sees: `&lt;` is `<`. Unknown entities stay as written. */
const decodeEntities = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (name[0] !== '#') return NAMED_ENTITIES[name.toLowerCase()] ?? entity;
    const isHex = name[1] === 'x' || name[1] === 'X';
    const point = isHex
      ? Number.parseInt(name.slice(2), 16)
      : Number(name.slice(1));
    return point > 0 && point <= 0x10ffff
      ? String.fromCodePoint(point)
      : entity;
  });

/** The formula starting at `pos` with the same delimiters as Markdown text (`$…$`, `$$…$$`, `~…~`), or null. */
function formulaAt(text: string, pos: number) {
  if (isEscaped(text, pos)) return null;
  const dollar = findDollarMath(text, pos, text.length);
  if (dollar)
    return {
      tex: dollar.tex,
      displayMode: dollar.isDisplay,
      after: dollar.after,
    };
  const tilde = findTildeMath(text, pos, text.length);
  return tilde && { tex: tilde.tex, displayMode: false, after: tilde.end + 1 };
}

/** One run of element text with its formulas rendered. */
function renderTextMath(text: string, renderFormula: RenderFormula): string {
  let html = '';
  let copied = 0;
  for (let pos = 0; pos < text.length; pos++) {
    if (text[pos] !== '$' && text[pos] !== '~') continue;
    const formula = formulaAt(text, pos);
    if (!formula) continue;
    html += text.slice(copied, pos);
    html += renderFormula(decodeEntities(formula.tex), formula.displayMode);
    copied = formula.after;
    pos = formula.after - 1;
  }
  return html + text.slice(copied);
}

/**
 * Raw HTML blocks with their formulas rendered. The old site typeset math in the browser over the whole statement, so `$n$` in a raw
 * `<table>` cell or on the lines after an `<img>` was math there; markdown-it leaves an HTML block's text alone. Text inside
 * pre, code, script, style and textarea stays literal; a formula never spans a tag.
 */
export function renderHtmlBlockMath(
  html: string,
  renderFormula: RenderFormula,
): string {
  if (!html.includes('$') && !html.includes('~')) return html;
  let rendered = '';
  let literalDepth = 0;
  let copied = 0;
  for (const tag of tagsOf(html)) {
    const text = html.slice(copied, tag.index);
    rendered += literalDepth ? text : renderTextMath(text, renderFormula);
    rendered += tag.text;
    const literal = LITERAL_ELEMENT.exec(tag.text);
    if (literal && !tag.text.endsWith('/>'))
      literalDepth = Math.max(0, literalDepth + (literal[1] ? -1 : 1));
    copied = tag.index + tag.text.length;
  }
  const rest = html.slice(copied);
  return rendered + (literalDepth ? rest : renderTextMath(rest, renderFormula));
}
