import katex from 'katex';
import MarkdownIt from 'markdown-it';

const DOLLAR = 0x24;
const TILDE = 0x7e;
const BACKSLASH = 0x5c;
const isSpace = (code: number) =>
  code === 0x20 || code === 0x0a || code === 0x09;
const isDigit = (code: number) => code >= 0x30 && code <= 0x39;
const MAX_SHOWN_LENGTH = 200;
const MAX_SIZE = 500;
const { escapeHtml } = new MarkdownIt().utils;
const truncate = (text: string) =>
  text.length > MAX_SHOWN_LENGTH ? `${text.slice(0, MAX_SHOWN_LENGTH)}…` : text;

/** KaTeX HTML+MathML for `tex`; any KaTeX failure (parse error, stack overflow on deep nesting) keeps the raw source in a `math-error` span so a bad formula never fails a save. */
export function renderMath(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, {
      displayMode,
      throwOnError: true,
      strict: 'ignore',
      trust: false,
      maxSize: MAX_SIZE,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const source = displayMode ? `$$${tex}$$` : `$${tex}$`;
    return `<span class="math-error" title="${escapeHtml(truncate(message))}">${escapeHtml(truncate(source))}</span>`;
  }
}

const isEscaped = (src: string, index: number): boolean => {
  let backslashes = 0;
  while (src.charCodeAt(index - 1 - backslashes) === BACKSLASH) backslashes++;
  return backslashes % 2 === 1;
};

/** Next `marker` at or after `from` that is not escaped by an odd number of backslashes, or -1. */
const indexOfUnescaped = (
  src: string,
  marker: string,
  from: number,
): number => {
  let index = src.indexOf(marker, from);
  while (index !== -1 && isEscaped(src, index))
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
  const end = indexOfUnescaped(src, marker, start);
  if (end === -1 || end >= posMax || end === start) return false;
  if (
    !display &&
    (isSpace(src.charCodeAt(end - 1)) || isDigit(src.charCodeAt(end + 1)))
  )
    return false;
  const tex = src.slice(start, end);
  if ((!display && tex.includes('\n')) || tex.includes('`')) return false;
  if (!silent)
    state.push(display ? 'math_display' : 'math_inline', 'span', 0).content =
      tex;
  state.pos = end + marker.length;
  return true;
}

/** `~x~` inline math (legacy `~.*?~`, so inner spaces are fine);  `~~` is strikethrough and is left to markdown-it. */
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
  if (start >= posMax) return false;
  const end = indexOfUnescaped(src, '~', start);
  if (end === -1 || end >= posMax || src.charCodeAt(end + 1) === TILDE)
    return false;
  const tex = src.slice(start, end);
  if (!tex.trim() || tex.includes('\n') || tex.includes('`')) return false;
  if (!silent) state.push('math_inline', 'span', 0).content = tex;
  state.pos = end + 1;
  return true;
}
