import katex from 'katex';
import type MarkdownIt from 'markdown-it';

const DOLLAR = 0x24;
const TILDE = 0x7e;
const BACKSLASH = 0x5c;
const isSpace = (code: number) =>
  code === 0x20 || code === 0x0a || code === 0x09;
const isDigit = (code: number) => code >= 0x30 && code <= 0x39;
const escapeHtml = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** KaTeX HTML+MathML for `tex`; a parse error keeps the raw source in a `math-error` span instead of failing the save. */
export function renderMath(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, {
      displayMode,
      throwOnError: true,
      strict: 'ignore',
      trust: false,
    });
  } catch (error) {
    if (!(error instanceof katex.ParseError)) throw error;
    const source = displayMode ? `$$${tex}$$` : `$${tex}$`;
    return `<span class="math-error" title="${escapeHtml(error.message)}">${escapeHtml(source)}</span>`;
  }
}

/** Next `marker` at or after `from` that is not backslash-escaped, or -1. */
const indexOfUnescaped = (
  src: string,
  marker: string,
  from: number,
): number => {
  let index = src.indexOf(marker, from);
  while (index !== -1 && src.charCodeAt(index - 1) === BACKSLASH)
    index = src.indexOf(marker, index + 1);
  return index;
};

/** `$…$` (one line; not `$ x$`, `$x $` or `$5 and $10`) and `$$…$$` (may span lines); never crosses a backtick, so code spans win. */
export function mathInlineRule(
  state: MarkdownIt.StateInline,
  silent: boolean,
): boolean {
  const { src, pos, posMax } = state;
  if (src.charCodeAt(pos) !== DOLLAR) return false;
  const display = src.charCodeAt(pos + 1) === DOLLAR;
  const marker = display ? '$$' : '$';
  const start = pos + marker.length;
  if (start >= posMax || (!display && isSpace(src.charCodeAt(start))))
    return false;
  let end = indexOfUnescaped(src, marker, start);
  while (
    end !== -1 &&
    end < posMax &&
    !display &&
    (isSpace(src.charCodeAt(end - 1)) || isDigit(src.charCodeAt(end + 1)))
  )
    end = indexOfUnescaped(src, marker, end + 1);
  if (end === -1 || end >= posMax || end === start) return false;
  const tex = src.slice(start, end);
  if ((!display && tex.includes('\n')) || tex.includes('`')) return false;
  if (!silent)
    state.push(display ? 'math_display' : 'math_inline', 'span', 0).content =
      tex;
  state.pos = end + marker.length;
  return true;
}

/** `~x~` inline math (legacy); `~~` is strikethrough and is left to markdown-it. */
export function mathTildeRule(
  state: MarkdownIt.StateInline,
  silent: boolean,
): boolean {
  const { src, pos, posMax } = state;
  if (
    src.charCodeAt(pos) !== TILDE ||
    src.charCodeAt(pos + 1) === TILDE ||
    (pos > 0 && src.charCodeAt(pos - 1) === TILDE)
  )
    return false;
  const start = pos + 1;
  if (start >= posMax || isSpace(src.charCodeAt(start))) return false;
  const end = indexOfUnescaped(src, '~', start);
  if (
    end === -1 ||
    end >= posMax ||
    isSpace(src.charCodeAt(end - 1)) ||
    src.charCodeAt(end + 1) === TILDE
  )
    return false;
  const tex = src.slice(start, end);
  if (tex.includes('\n') || tex.includes('`')) return false;
  if (!silent) state.push('math_inline', 'span', 0).content = tex;
  state.pos = end + 1;
  return true;
}
