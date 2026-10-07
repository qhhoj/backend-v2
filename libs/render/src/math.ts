import katex from 'katex';
import type MarkdownIt from 'markdown-it';

const DOLLAR = 0x24;
const TILDE = 0x7e;
const BACKSLASH = 0x5c;
const isSpace = (code: number) =>
  code === 0x20 || code === 0x0a || code === 0x09;
const isDigit = (code: number) => code >= 0x30 && code <= 0x39;
const MAX_SHOWN_LENGTH = 200;
const MAX_SIZE = 500;
const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};
const escapeHtml = (text: string) =>
  text.replace(/[&<>"]/g, (char) => HTML_ESCAPES[char]);
const truncate = (text: string) =>
  text.length > MAX_SHOWN_LENGTH ? `${text.slice(0, MAX_SHOWN_LENGTH)}…` : text;

/** Per-render limits on KaTeX work and output; one instance lives in the markdown-it `env` of each render. */
export type MathBudget = {
  /** User-authored text: tighter KaTeX limits, no parametered macros, a wall-clock budget. */
  userAuthored: boolean;
  /** Milliseconds clock; replaceable so the time budget is testable. */
  clock: () => number;
  startedAt: number;
  formulas: number;
  outputBytes: number;
  limitReported: boolean;
};
export const MAX_FORMULAS = 2000;
export const MAX_FORMULA_LENGTH = 1000;
export const MAX_MATH_OUTPUT_BYTES = 1.5 * 1024 * 1024;
/** Total KaTeX time one user-authored render may spend; later formulas show as source. */
export const MAX_USER_MATH_MILLISECONDS = 500;
const USER_MAX_EXPAND = 50;
const USER_MAX_SIZE = 50;
export const createMathBudget = (
  userAuthored = false,
  clock: () => number = () => performance.now(),
): MathBudget => ({
  userAuthored,
  clock,
  startedAt: clock(),
  formulas: 0,
  outputBytes: 0,
  limitReported: false,
});

const sourceOf = (tex: string, displayMode: boolean) =>
  truncate(displayMode ? `$$${tex}$$` : `$${tex}$`);
const mathError = (tex: string, displayMode: boolean, message: string) =>
  `<span class="math-error" title="${escapeHtml(truncate(message))}">${escapeHtml(sourceOf(tex, displayMode))}</span>`;

/** An unescaped `#` is a macro parameter in KaTeX (nothing else uses it); a macro that repeats its argument multiplies the output per expansion. `[` after a definer is a `\\newcommand` argument count. */
const PARAMETER_MACRO =
  /(?<!\\)#|\\(?:[gex]?def|(?:re)?newcommand|providecommand|(?:re)?newenvironment)(?![A-Za-z])[^]*\[/;

/** KaTeX HTML+MathML for `tex`; any KaTeX failure (parse error, stack overflow on deep nesting) or a spent `budget` keeps the raw source in a `math-error` span so a bad formula never fails a save. */
export function renderMath(
  tex: string,
  displayMode: boolean,
  budget?: MathBudget,
): string {
  if (
    budget &&
    (++budget.formulas > MAX_FORMULAS ||
      tex.length > MAX_FORMULA_LENGTH ||
      budget.outputBytes > MAX_MATH_OUTPUT_BYTES)
  ) {
    if (budget.limitReported) return escapeHtml(sourceOf(tex, displayMode));
    budget.limitReported = true;
    return mathError(tex, displayMode, 'Formula limit exceeded');
  }
  if (budget?.userAuthored) {
    if (budget.clock() - budget.startedAt > MAX_USER_MATH_MILLISECONDS)
      return escapeHtml(sourceOf(tex, displayMode));
    if (PARAMETER_MACRO.test(tex))
      return mathError(
        tex,
        displayMode,
        'Macros with parameters are not allowed here',
      );
  }
  try {
    const html = katex.renderToString(tex, {
      displayMode,
      throwOnError: true,
      strict: 'ignore',
      trust: false,
      maxSize: budget?.userAuthored ? USER_MAX_SIZE : MAX_SIZE,
      ...(budget?.userAuthored ? { maxExpand: USER_MAX_EXPAND } : {}),
    });
    if (budget) {
      if (budget.outputBytes + html.length > MAX_MATH_OUTPUT_BYTES) {
        budget.outputBytes = MAX_MATH_OUTPUT_BYTES + 1;
        budget.limitReported = true;
        return mathError(tex, displayMode, 'Formula limit exceeded');
      }
      budget.outputBytes += html.length;
    }
    return html;
  } catch (error) {
    return mathError(
      tex,
      displayMode,
      error instanceof Error ? error.message : String(error),
    );
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
