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
import { sanitizeStatementHtml } from './sanitizer';
import { rewriteHtmlSpoilers, spoilerRule } from './spoiler';
import { allowsRawHtml, isSanitizedStyle, RenderStyle } from './styles';
import { dashesRule } from './typography';
import { renderUserReference, userReferenceRule } from './user-reference';

export { renderMath } from './math';

/** markdown-it `env` of one render. */
type RenderEnv = { budget: MathBudget };

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

function createMarkdown(html: boolean): MarkdownIt.MarkdownIt {
  const markdown = new MarkdownIt({ html, typographer: true });
  markdown.disable('replacements');
  markdown.core.ruler.after('smartquotes', 'dashes', dashesRule);
  markdown.inline.ruler.before('escape', 'math_inline', mathInlineRule);
  markdown.inline.ruler.before('strikethrough', 'math_tilde', mathTildeRule);
  markdown.inline.ruler.before('link', 'user_reference', userReferenceRule);
  markdown.block.ruler.before('blockquote', 'spoiler', spoilerRule, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });
  markdown.renderer.rules.math_inline = (tokens, index, _options, env) =>
    renderMath(tokens[index].content, false, (env as RenderEnv).budget);
  markdown.renderer.rules.math_display = (tokens, index, _options, env) =>
    renderMath(tokens[index].content, true, (env as RenderEnv).budget);
  markdown.renderer.rules.user_reference = renderUserReference;
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

const markdowns = { raw: createMarkdown(true), escaped: createMarkdown(false) };

const MAX_MARKUP_TAGS = 200000;
const MAX_MARKUP_DEPTH = 500;
const MAX_HTML_BYTES = 2 * 1024 * 1024;

/** Statement Markdown → HTML; sanitized unless `style` is `problem-full`. Throws `RenderLimitError` when the markup is too large or too deeply nested. */
export function renderMarkdown(text: string, style: RenderStyle): string {
  const rendered = wrapTables(
    shiftHeaders(
      markdowns[allowsRawHtml(style) ? 'raw' : 'escaped'].render(
        rewriteHtmlSpoilers(text),
        { budget: createMathBudget() } satisfies RenderEnv,
      ),
    ),
  );
  if (
    !isMarkupWithinLimits(rendered, {
      maxTags: MAX_MARKUP_TAGS,
      maxDepth: MAX_MARKUP_DEPTH,
      mode: 'html',
    })
  )
    throw new RenderLimitError(
      'Markup has too many tags or is nested too deep',
    );
  const html = isSanitizedStyle(style)
    ? sanitizeStatementHtml(rendered)
    : rendered;
  if (Buffer.byteLength(html) > MAX_HTML_BYTES)
    throw new RenderLimitError('Rendered HTML is too large');
  return html;
}
