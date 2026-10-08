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
import { MATH_SLOT_ATTRIBUTE, sanitizeBlogHtml } from './blog-sanitizer';
import { sanitizeStatementHtml } from './sanitizer';
import { rewriteHtmlSpoilers, spoilerRule } from './spoiler';
import {
  allowsRawHtml,
  isSanitizedStyle,
  isUserAuthored,
  RenderStyle,
} from './styles';
import { dashesRule } from './typography';
import { renderUserReference, userReferenceRule } from './user-reference';

export { renderMath } from './math';

/** markdown-it `env` of one render. */
type RenderEnv = {
  budget: MathBudget;
  /** The `blog` style only: formulas wait here (KaTeX HTML is trusted) while the author's HTML is sanitized. */
  deferredMath?: { nonce: string; formulas: string[] };
};

/** A slot element standing for the formula; sanitizing leaves it alone and `spliceMath` replaces it. */
function deferMath(env: RenderEnv, html: string): string {
  if (!env.deferredMath) return html;
  const { nonce, formulas } = env.deferredMath;
  formulas.push(html);
  return `<span ${MATH_SLOT_ATTRIBUTE}="${nonce}-${formulas.length - 1}"></span>`;
}

function spliceMath(
  html: string,
  { nonce, formulas }: { nonce: string; formulas: string[] },
): string {
  return html.replace(
    new RegExp(`<span ${MATH_SLOT_ATTRIBUTE}="${nonce}-(\\d+)"></span>`, 'g'),
    (slot, index: string) => formulas[Number(index)] ?? slot,
  );
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
}: {
  allowsHtml: boolean;
}): MarkdownIt.MarkdownIt {
  const markdown = new MarkdownIt({ html: allowsHtml, typographer: true });
  markdown.disable('replacements');
  markdown.core.ruler.after('smartquotes', 'dashes', dashesRule);
  markdown.inline.ruler.before('escape', 'math_inline', mathInlineRule);
  markdown.inline.ruler.before('strikethrough', 'math_tilde', mathTildeRule);
  markdown.inline.ruler.before('link', 'user_reference', userReferenceRule);
  markdown.block.ruler.before('blockquote', 'spoiler', spoilerRule, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });
  markdown.renderer.rules.math_inline = (tokens, index, _options, env) =>
    deferMath(
      env as RenderEnv,
      renderMath(tokens[index].content, false, (env as RenderEnv).budget),
    );
  markdown.renderer.rules.math_display = (tokens, index, _options, env) =>
    deferMath(
      env as RenderEnv,
      renderMath(tokens[index].content, true, (env as RenderEnv).budget),
    );
  markdown.renderer.rules.user_reference = renderUserReference;
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
  raw: createMarkdown({ allowsHtml: true }),
  escaped: createMarkdown({ allowsHtml: false }),
};

const MAX_MARKUP_TAGS = 200000;
const MAX_MARKUP_DEPTH = 500;
const MAX_HTML_BYTES = 2 * 1024 * 1024;

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

/** Statement Markdown → HTML; sanitized unless `style` is `problem-full`. The `blog` style sanitizes the author's HTML with formulas held aside (KaTeX output is trusted and spliced in afterwards, never sharing the author's sanitizer pass). Throws `RenderLimitError` when the markup is too large or too deeply nested. */
export function renderMarkdown(text: string, style: RenderStyle): string {
  const env: RenderEnv = {
    budget: createMathBudget(isUserAuthored(style)),
    ...(style === 'blog'
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
      markdowns[allowsRawHtml(style) ? 'raw' : 'escaped'].render(
        rewriteHtmlSpoilers(text),
        env,
      ),
    ),
  );
  assertWithinMarkupLimits(rendered);
  let html: string;
  if (env.deferredMath) {
    html = spliceMath(sanitizeBlogHtml(rendered), env.deferredMath);
    assertWithinMarkupLimits(html);
  } else
    html = isSanitizedStyle(style) ? sanitizeStatementHtml(rendered) : rendered;
  if (Buffer.byteLength(html) > MAX_HTML_BYTES)
    throw new RenderLimitError('Rendered HTML is too large');
  return html;
}
