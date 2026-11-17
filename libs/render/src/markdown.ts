import { randomBytes } from 'node:crypto';
import MarkdownIt from 'markdown-it';
import { isMarkupWithinLimits } from './markup-limits';
import {
  createMathBudget,
  mathInlineRule,
  mathTildeRule,
  MathBudget,
  renderMath,
} from './math';
import { RenderLimitError } from './render-limit.error';
import { compactHeadingRule } from './compact-heading';
import { separateFencesFromHtml } from './fences';
import { renderHtmlBlockMath } from './html-block-math';
import { MATH_SLOT_ATTRIBUTE, sanitizeBlogHtml } from './blog-sanitizer';
import {
  sanitizeStatementAuthorHtml,
  sanitizeStatementHtml,
} from './sanitizer';
import { rewriteHtmlSpoilers, spoilerRule } from './spoiler';
import { isSanitizedStyle, isUserAuthored, RenderStyle } from './styles';
import {
  problemReferenceRule,
  renderProblemReference,
} from './problem-reference';
import type { ProblemLinks } from './problem-reference';

export type { ProblemLinks } from './problem-reference';
import { renderUserReference, userReferenceRule } from './user-reference';

export { renderMath } from './math';

/** markdown-it `env` of one render. */
type RenderEnv = {
  budget: MathBudget;
  /** Sanitized styles: formulas wait here while the author's HTML is sanitized under its own rules. */
  deferredMath?: { nonce: string; formulas: string[] };
  /** `#C` problem references; absent, `#C` stays text. */
  problemLinks?: ProblemLinks;
  /** Table cells (header and body, padded short rows included) this render may still lay out; absent, no limit. */
  tableCellsLeft?: number;
};

/** A slot element standing for the formula; sanitizing leaves it alone and `spliceMath` replaces it. */
function deferMath(env: RenderEnv, html: string): string {
  if (!env.deferredMath) return html;
  const { nonce, formulas } = env.deferredMath;
  formulas.push(html);
  return `<span ${MATH_SLOT_ATTRIBUTE}="${nonce}-${formulas.length - 1}"></span>`;
}

/** One formula of this render: KaTeX within the render's budget, deferred in the blog style. */
const formulaHtml = (env: RenderEnv, tex: string, displayMode: boolean) =>
  deferMath(env, renderMath(tex, displayMode, env.budget));

function spliceMath(
  html: string,
  { nonce, formulas }: { nonce: string; formulas: string[] },
): string {
  return html.replace(
    new RegExp(`<span ${MATH_SLOT_ATTRIBUTE}="${nonce}-(\\d+)"></span>`, 'g'),
    (slot, index: string) => formulas[Number(index)] ?? slot,
  );
}

/** Author HTML and formulas of a sanitized style, each under its own rules: blog formulas are trusted as KaTeX made them; statement formulas keep the statement allow-list they always had. */
function sanitizeWithMath(
  rendered: string,
  style: RenderStyle,
  deferred: { nonce: string; formulas: string[] },
): string {
  if (style === 'blog') return spliceMath(sanitizeBlogHtml(rendered), deferred);
  return spliceMath(sanitizeStatementAuthorHtml(rendered), {
    nonce: deferred.nonce,
    formulas: sanitizeEach(deferred.formulas, deferred.nonce),
  });
}

/** `sanitizeStatementHtml` of each formula in one sanitizer pass: each formula is closed HTML, so joining them with a text separator gives the same pieces as one pass per formula, without the fixed cost of a pass per formula. */
export function sanitizeEach(formulas: string[], nonce: string): string[] {
  if (formulas.length < 2) return formulas.map(sanitizeStatementHtml);
  const separator = `math-separator-${nonce}`;
  const pieces = sanitizeStatementHtml(formulas.join(separator)).split(
    separator,
  );
  return pieces.length === formulas.length
    ? pieces
    : formulas.map(sanitizeStatementHtml);
}

type BlockRule = (
  state: MarkdownIt.StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean,
) => boolean;

const isCellOpen = (token: { type: string }) =>
  token.type === 'td_open' || token.type === 'th_open';

/**
 * markdown-it's table rule within `env.tableCellsLeft`, padded short rows included. The rule reads only as many lines
 * as the cells left allow (the delimiter row's pipes bound the width); a table that reaches that line or lays out more
 * cells is refused before any cell is parsed inline or rendered. Tables that fit are laid out unchanged.
 */
const withTableCellLimit =
  (table: BlockRule): BlockRule =>
  (state, startLine, endLine, silent) => {
    const env = state.env as RenderEnv;
    const cellsLeft = env.tableCellsLeft;
    if (silent || cellsLeft === undefined || startLine + 2 > endLine)
      return table(state, startLine, endLine, silent);
    const delimiterRow = startLine + 1;
    const widthBound = state.src
      .slice(state.bMarks[delimiterRow], state.eMarks[delimiterRow])
      .split('|').length;
    const lineLimit = Math.min(
      endLine,
      delimiterRow + 2 + Math.floor(cellsLeft / widthBound),
    );
    const firstToken = state.tokens.length;
    if (!table(state, startLine, lineLimit, false)) return false;
    env.tableCellsLeft =
      cellsLeft - state.tokens.slice(firstToken).filter(isCellOpen).length;
    if (
      env.tableCellsLeft < 0 ||
      (lineLimit < endLine && state.line >= lineLimit)
    )
      throw new RenderLimitError('Tables have too many cells');
    return true;
  };

/** Puts `withTableCellLimit` around the parser's own table rule, keeping its place and alternatives. */
function limitTableCells(markdown: MarkdownIt.MarkdownIt): void {
  const { fn, alt } = markdown.block.ruler.__rules__.find(
    (rule) => rule.name === 'table',
  )!;
  markdown.block.ruler.at('table', withTableCellLimit(fn), { alt });
}

const MAX_HEADER_LEVEL = 6;
/** Legacy `inc_header`: bare header tags shift by two (capped at h6 instead of producing h7/h8). */
const shiftHeaders = (html: string) =>
  html.replace(
    /<(\/?)h([1-6])>/g,
    (_match, slash: string, level: string) =>
      `<${slash}h${Math.min(Number(level) + 2, MAX_HEADER_LEVEL)}>`,
  );
/** Legacy `add_table_class`/`end_table_class`: a string replace, so raw-HTML tables are wrapped too. */
const wrapTables = (html: string) =>
  html
    .replaceAll(
      '<table>',
      '<div class="h-scrollable-table"><table class="table">',
    )
    .replaceAll('</table>', '</table></div>');

function createMarkdown({
  allowsHtml,
  compactHeadings,
}: {
  allowsHtml: boolean;
  compactHeadings: boolean;
}): MarkdownIt.MarkdownIt {
  // No typographer: the old site kept straight quotes, `...` and `--` as written.
  const markdown = new MarkdownIt({ html: allowsHtml });
  // Only text that came from the old site may use `##Input`; in text typed today `#include<x>` is code.
  if (compactHeadings) {
    markdown.block.ruler.before(
      'heading',
      'compact_heading',
      compactHeadingRule,
      {
        alt: ['paragraph', 'reference', 'blockquote'],
      },
    );
  }
  limitTableCells(markdown);
  markdown.inline.ruler.before('escape', 'math_inline', mathInlineRule);
  markdown.inline.ruler.before('strikethrough', 'math_tilde', mathTildeRule);
  markdown.inline.ruler.before('link', 'user_reference', userReferenceRule);
  markdown.inline.ruler.before(
    'link',
    'problem_reference',
    problemReferenceRule,
  );
  markdown.block.ruler.before('blockquote', 'spoiler', spoilerRule, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });
  markdown.renderer.rules.math_inline = (tokens, index, _options, env) =>
    formulaHtml(env as RenderEnv, tokens[index].content, false);
  markdown.renderer.rules.math_display = (tokens, index, _options, env) =>
    formulaHtml(env as RenderEnv, tokens[index].content, true);
  markdown.renderer.rules.html_block = (tokens, index, _options, env) =>
    renderHtmlBlockMath(tokens[index].content, (tex, displayMode) =>
      formulaHtml(env as RenderEnv, tex, displayMode),
    );
  markdown.renderer.rules.user_reference = renderUserReference;
  markdown.renderer.rules.problem_reference = renderProblemReference;
  // eslint-disable-next-line no-restricted-syntax -- markdown-it's renderer rule signature
  markdown.renderer.rules.link_open = (tokens, index, options, _env, self) => {
    const token = tokens[index];
    if (!String(token.attrGet('href') ?? '').startsWith('#')) {
      token.attrSet('rel', 'nofollow noopener');
      token.attrSet('target', '_blank');
    }
    return self.renderToken(tokens, index, options);
  };
  return markdown;
}

const markdowns = {
  raw: createMarkdown({ allowsHtml: true, compactHeadings: true }),
  blog: createMarkdown({ allowsHtml: true, compactHeadings: false }),
  escaped: createMarkdown({ allowsHtml: false, compactHeadings: false }),
};

/** The Markdown parser of a style: `user` shows HTML as text, `blog` and `user` have no compact headings. */
const markdownOf = (style: RenderStyle) =>
  style === 'user'
    ? markdowns.escaped
    : style === 'blog'
      ? markdowns.blog
      : markdowns.raw;

const MAX_MARKUP_TAGS = 200000;
const MAX_MARKUP_DEPTH = 500;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const KIB = 1024;

/** `user`-style budgets for text up to 8 KiB (a comment or ticket message at its length cap). */
const USER_MATH_BYTES = 160 * KIB;
const USER_HTML_BYTES = 320 * KIB;
/** Formula parse work (user-macro tokens expanded plus parse-tree objects): about eight times what 8 KiB of ordinary formulas use before the formula output budget runs out. */
const USER_MATH_WORK = 10_000;
/** Table cells beyond one per source byte: a written cell takes at least one byte, so only padded short rows reach this. */
const USER_EXTRA_TABLE_CELLS = 1024;

type RenderLimits = {
  html: number;
  math?: number;
  mathWork?: number;
  tableCells?: number;
};

/** Output and work budgets of one render. The `user` style (comments, ticket messages, profile and organization about) allows 160 KiB of formulas, 320 KiB of HTML and 10,000 units of formula parse work, more for longer text (16 and 32 bytes and one unit per source byte), and one table cell per source byte plus 1,024, so short text renders with bounded work and to bounded HTML. */
function limitsOf(text: string, style: RenderStyle): RenderLimits {
  if (style !== 'user') return { html: MAX_HTML_BYTES };
  const sourceBytes = Buffer.byteLength(text);
  return {
    html: Math.min(MAX_HTML_BYTES, Math.max(USER_HTML_BYTES, 32 * sourceBytes)),
    math: Math.max(USER_MATH_BYTES, 16 * sourceBytes),
    mathWork: Math.max(USER_MATH_WORK, sourceBytes),
    tableCells: sourceBytes + USER_EXTRA_TABLE_CELLS,
  };
}

const assertWithinBytes = (html: string, maxBytes: number): void => {
  if (Buffer.byteLength(html) > maxBytes)
    throw new RenderLimitError('Rendered HTML is too large');
};

const assertWithinMarkupLimits = (html: string): void => {
  if (
    !isMarkupWithinLimits(html, {
      maxTags: MAX_MARKUP_TAGS,
      maxDepth: MAX_MARKUP_DEPTH,
      mode: 'html',
    })
  )
    throw new RenderLimitError(
      'Markup has too many tags or is nested too deep',
    );
};

/** Statement Markdown → HTML; sanitized unless `style` is `problem-full`. Sanitized styles sanitize the author's HTML with formulas held aside and spliced in afterwards, never sharing the author's sanitizer pass. Throws `RenderLimitError` when the markup is too large or too deeply nested. `problemLinks` turns `#C` into an anchor for the problem labelled C. */
export function renderMarkdown(
  text: string,
  style: RenderStyle,
  { problemLinks }: { problemLinks?: ProblemLinks } = {},
): string {
  const limits = limitsOf(text, style);
  const env: RenderEnv = {
    budget: createMathBudget(
      isUserAuthored(style),
      undefined,
      limits.math,
      limits.mathWork,
    ),
    problemLinks,
    tableCellsLeft: limits.tableCells,
    ...(isSanitizedStyle(style)
      ? {
          deferredMath: {
            nonce: randomBytes(12).toString('hex'),
            formulas: [],
          },
        }
      : {}),
  };
  const rendered = wrapTables(
    shiftHeaders(
      markdownOf(style).render(
        rewriteHtmlSpoilers(separateFencesFromHtml(text)),
        env,
      ),
    ),
  );
  assertWithinBytes(rendered, limits.html);
  assertWithinMarkupLimits(rendered);
  let html = rendered;
  if (env.deferredMath) {
    html = sanitizeWithMath(rendered, style, env.deferredMath);
    assertWithinMarkupLimits(html);
  }
  assertWithinBytes(html, limits.html);
  return html;
}
