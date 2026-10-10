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
  /** User-authored text: tighter KaTeX limits, no parametered macros, no dimension beyond ±50em, a wall-clock budget. */
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
/** Total KaTeX time one user-authored render may spend; the first formula past it is a `math-error`, later ones show as source. */
export const MAX_USER_MATH_MILLISECONDS = 500;
const USER_MAX_EXPAND = 50;
const USER_MAX_SIZE = 50;
const SIZE_REFUSAL = `Sizes beyond ±${USER_MAX_SIZE}em are not allowed here`;
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

/** A colour command with its `{#hex}` arguments (KaTeX's colour regex); blanked before looking for parameters, so a `#` anywhere else is still one. */
const HEX_COLOR_COMMAND =
  /\\(?:textcolor|color|colorbox|fcolorbox)\s*(?:\{#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\}\s*){1,2}/gi;
/** Any other unescaped `#` is a macro parameter in KaTeX; a macro that repeats its argument multiplies the output per expansion. `[` right after a `\\newcommand`-family name is an argument count. */
const PARAMETER_MACRO =
  /(?<!\\)#|\\(?:(?:re)?newcommand|providecommand)\s*(?:\{\s*)?\\[A-Za-z@]+\s*(?:\}\s*)?\[/;
const definesParameterMacro = (tex: string) =>
  PARAMETER_MACRO.test(tex.replace(HEX_COLOR_COMMAND, '\\textcolor{}'));

/** KaTeX's points per absolute unit (`katex/src/units.ts`); 10pt is 1em. */
const POINTS_PER_UNIT: Record<string, number> = {
  pt: 1,
  mm: 7227 / 2540,
  cm: 7227 / 254,
  in: 72.27,
  bp: 803 / 800,
  pc: 12,
  dd: 1238 / 1157,
  cc: 14856 / 1157,
  nd: 685 / 642,
  nc: 1370 / 107,
  sp: 1 / 65536,
  px: 803 / 800,
};
const EMS_PER_RELATIVE_UNIT: Record<string, number> = {
  em: 1,
  ex: 0.431,
  mu: 1 / 18,
};
type Measurement = { number: number; unit: string };
const isMeasurement = (node: object): node is Measurement =>
  typeof (node as Measurement).number === 'number' &&
  typeof (node as Measurement).unit === 'string';
/** An unknown unit is infinitely large, so the size check fails closed. */
const emsOf = ({ number, unit }: Measurement) =>
  number *
  (EMS_PER_RELATIVE_UNIT[unit] ?? (POINTS_PER_UNIT[unit] ?? Infinity) / 10);
/**
 * Parse-tree objects (`loc` excluded) a user formula may have. Bounds KaTeX's build cost whatever macros produced the tree;
 * build time grows faster than linearly (adjacent symbols), measured warm on katex 0.19.0:
 * largest legitimate formulas at the 1000-char source cap ≤ 2k objects (2-column array 1929, 1000 letters 1001, 150-row array 1058),
 * a `\def`'d 20-cell array used 48 times 5761; just under the cap `x` × 19k is ~250 ms (550 ms cold), `\sqrt{x}` × 5000 ~350 ms and a 6 MB string (then refused by the output cap);
 * `x` × 38k–43k objects (48 expansions of an 800–900-letter `\def`) took 1.4–2.7 s.
 */
export const MAX_USER_FORMULA_NODES = 20_000;
type TreeWalk = { nodes: number };
/** Why a user formula's parse tree is refused (too many objects, a dimension or `\arraystretch` beyond ±`USER_MAX_SIZE`), or undefined; stops at the first breach. */
const refusalIn = (node: unknown, walk: TreeWalk): string | undefined => {
  if (typeof node !== 'object' || node === null) return undefined;
  if (++walk.nodes > MAX_USER_FORMULA_NODES) return 'Formula too large';
  if (isMeasurement(node) && !(Math.abs(emsOf(node)) <= USER_MAX_SIZE))
    return SIZE_REFUSAL;
  for (const [key, child] of Object.entries(node)) {
    if (key === 'loc') continue;
    // KaTeX reads `\arraystretch` as a plain number (rows grow by `stretch - 1` em); `\arraycolsep` and `\jot` are fixed.
    if (key === 'arraystretch' && !((child as number) <= USER_MAX_SIZE))
      return SIZE_REFUSAL;
    const refusal = refusalIn(child, walk);
    if (refusal) return refusal;
  }
  return undefined;
};
/** Why a user formula's parse tree is refused, or undefined. */
export const formulaRefusal = (tree: unknown) => refusalIn(tree, { nodes: 0 });
/** KaTeX's parse tree, macros expanded: an internal export, safe because `katex` is pinned to an exact version. */
const parseTree = (
  katex as unknown as {
    __parse: (tex: string, options: katex.KatexOptions) => unknown;
  }
).__parse;

/** A spent count, size or time limit: the first formula past it says why, later ones show as plain source. */
const limitExceeded = (
  budget: MathBudget,
  tex: string,
  displayMode: boolean,
  message: string,
) => {
  if (budget.limitReported) return escapeHtml(sourceOf(tex, displayMode));
  budget.limitReported = true;
  return mathError(tex, displayMode, message);
};

/** KaTeX HTML+MathML for `tex`; any KaTeX failure (parse error, stack overflow on deep nesting) or a spent `budget` keeps the raw source in a `math-error` span so a bad formula never fails a save. */
// eslint-disable-next-line complexity -- essential: one KaTeX render behind the budget checks, which must run in this order (see the doc comment)
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
  )
    return limitExceeded(budget, tex, displayMode, 'Formula limit exceeded');
  const userAuthored = budget?.userAuthored ?? false;
  if (budget && userAuthored) {
    if (budget.clock() - budget.startedAt > MAX_USER_MATH_MILLISECONDS)
      return limitExceeded(
        budget,
        tex,
        displayMode,
        'Formula time limit exceeded',
      );
    if (definesParameterMacro(tex))
      return mathError(
        tex,
        displayMode,
        'Macros with parameters are not allowed here',
      );
  }
  const options: katex.KatexOptions = {
    displayMode,
    throwOnError: true,
    strict: 'ignore',
    trust: false,
    maxSize: userAuthored ? USER_MAX_SIZE : MAX_SIZE,
    ...(userAuthored ? { maxExpand: USER_MAX_EXPAND } : {}),
  };
  try {
    const refusal = userAuthored && formulaRefusal(parseTree(tex, options));
    if (refusal) return mathError(tex, displayMode, refusal);
    const html = katex.renderToString(tex, options);
    if (budget) {
      if (budget.outputBytes + html.length > MAX_MATH_OUTPUT_BYTES) {
        budget.outputBytes = MAX_MATH_OUTPUT_BYTES + 1;
        return limitExceeded(
          budget,
          tex,
          displayMode,
          'Formula limit exceeded',
        );
      }
      budget.outputBytes += html.length;
    }
    return html;
  } catch (error) {
    return mathError(
      tex,
      displayMode,
      error instanceof katex.ParseError ? error.message : 'Invalid formula',
    );
  }
}

/** Whether the character at `index` follows an odd run of backslashes. */
export const isEscaped = (src: string, index: number): boolean => {
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

const DOLLAR_MARKER = '$';
const DISPLAY_MARKER = '$$';
const markerOf = (isDisplay: boolean) =>
  isDisplay ? DISPLAY_MARKER : DOLLAR_MARKER;

interface DollarMath {
  tex: string;
  isDisplay: boolean;
  /** Index of the closing marker. */
  end: number;
  /** Index just past the closing marker, where the inline scan resumes. */
  after: number;
}

/**
 * Index of the closing marker for a span whose body starts at `start`, or -1 when the span is refused:
 * a single-dollar span must not end after a space or before a digit (`$5 and $10`), and an empty span is refused.
 */
function findClosingDollar(
  src: string,
  isDisplay: boolean,
  start: number,
  posMax: number,
): number {
  const end = indexOfUnescaped(src, markerOf(isDisplay), start);
  // markdown-it's inline rules must not read past posMax (a link label's end while the label is tokenized).
  if (end === -1 || end >= posMax || end === start) return -1;
  if (isDisplay) return end;
  const endsAfterSpace = isSpace(src.charCodeAt(end - 1));
  const endsBeforeDigit = isDigit(src.charCodeAt(end + 1));
  return endsAfterSpace || endsBeforeDigit ? -1 : end;
}

/** `$…$` (one line; not `$ x$`, `$x $` or `$5 and $10`) or `$$…$$` (may span lines) starting at `pos`. */
export function findDollarMath(
  src: string,
  pos: number,
  posMax: number,
): DollarMath | null {
  if (src.charCodeAt(pos) !== DOLLAR) return null;
  const isDisplay = src.charCodeAt(pos + 1) === DOLLAR;
  const start = pos + markerOf(isDisplay).length;
  if (!isDisplay && isSpace(src.charCodeAt(start))) return null;
  const end = findClosingDollar(src, isDisplay, start, posMax);
  if (end === -1) return null;
  const tex = src.slice(start, end);
  if (!isDisplay && tex.includes('\n')) return null;
  return { tex, isDisplay, end, after: end + markerOf(isDisplay).length };
}

/** Start index of the last backtick run of each length in `src`. */
function lastBacktickRuns(src: string): Map<number, number> {
  const runs = new Map<number, number>();
  for (const run of src.matchAll(/`+/g)) runs.set(run[0].length, run.index);
  return runs;
}
const backtickRunsOf = new WeakMap<
  MarkdownIt.StateInline,
  Map<number, number>
>();

/**
 * Whether a backtick run inside `src[start, end)` has an equal run later in the text, so a code span would open inside the
 * formula and close past it: the code span wins then. A lone run (`~\texttt{``}~`) is just TeX, as on the old site.
 */
function crossesCodeSpan(
  state: MarkdownIt.StateInline,
  start: number,
  end: number,
): boolean {
  const formula = state.src.slice(start, end);
  if (!formula.includes('`')) return false;
  let runs = backtickRunsOf.get(state);
  if (!runs) backtickRunsOf.set(state, (runs = lastBacktickRuns(state.src)));
  for (const run of formula.matchAll(/`+/g)) {
    const runEnd = start + run.index + run[0].length;
    if ((runs.get(run[0].length) ?? -1) >= runEnd) return true;
  }
  return false;
}

export function mathInlineRule(
  state: MarkdownIt.StateInline,
  silent: boolean,
): boolean {
  const math = findDollarMath(state.src, state.pos, state.posMax);
  if (!math || crossesCodeSpan(state, state.pos, math.end)) return false;
  if (!silent)
    state.push(
      math.isDisplay ? 'math_display' : 'math_inline',
      'span',
      0,
    ).content = math.tex;
  state.pos = math.after;
  return true;
}

/** `~x~` starting at `pos` (legacy `~.*?~`, so inner spaces are fine; one line, not blank); `~~` is strikethrough, not math. */
export function findTildeMath(
  src: string,
  pos: number,
  posMax: number,
): { tex: string; end: number } | null {
  if (
    src.charCodeAt(pos) !== TILDE ||
    src.charCodeAt(pos + 1) === TILDE ||
    (pos > 0 && src.charCodeAt(pos - 1) === TILDE)
  )
    return null;
  const start = pos + 1;
  if (start >= posMax) return null;
  const end = indexOfUnescaped(src, '~', start);
  if (end === -1 || end >= posMax || src.charCodeAt(end + 1) === TILDE)
    return null;
  const tex = src.slice(start, end);
  return !tex.trim() || tex.includes('\n') ? null : { tex, end };
}

/** `~x~` inline math; `~~` is strikethrough and is left to markdown-it. */
export function mathTildeRule(
  state: MarkdownIt.StateInline,
  silent: boolean,
): boolean {
  const math = findTildeMath(state.src, state.pos, state.posMax);
  if (!math || crossesCodeSpan(state, state.pos, math.end)) return false;
  if (!silent) state.push('math_inline', 'span', 0).content = math.tex;
  state.pos = math.end + 1;
  return true;
}
