import { findDollarMath, findTildeMath, isEscaped } from './math';

/** KaTeX HTML for one formula found in raw HTML (the caller applies the render budget and the blog style's deferral). */
export type RenderFormula = (tex: string, displayMode: boolean) => string;

/** A comment or a start/end tag; the text between two matches is element text. */
const TAG = /<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>/g;
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
  for (const tag of html.matchAll(TAG)) {
    const text = html.slice(copied, tag.index);
    rendered += literalDepth ? text : renderTextMath(text, renderFormula);
    rendered += tag[0];
    const literal = LITERAL_ELEMENT.exec(tag[0]);
    if (literal && !tag[0].endsWith('/>'))
      literalDepth = Math.max(0, literalDepth + (literal[1] ? -1 : 1));
    copied = tag.index + tag[0].length;
  }
  const rest = html.slice(copied);
  return rendered + (literalDepth ? rest : renderTextMath(rest, renderFormula));
}
