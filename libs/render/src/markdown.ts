import MarkdownIt from 'markdown-it';
import { mathInlineRule, mathTildeRule, renderMath } from './math';
import { sanitizeStatementHtml } from './sanitizer';
import { rewriteHtmlSpoilers, spoilerRule } from './spoiler';
import { isSanitizedStyle, RenderStyle } from './styles';
import { dashesRule } from './typography';
import { renderUserReference, userReferenceRule } from './user-reference';

export { renderMath } from './math';

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

function createMarkdown(): MarkdownIt.MarkdownIt {
  const markdown = new MarkdownIt({ html: true, typographer: true });
  markdown.disable('replacements');
  markdown.core.ruler.after('smartquotes', 'dashes', dashesRule);
  markdown.inline.ruler.before('escape', 'math_inline', mathInlineRule);
  markdown.inline.ruler.before('strikethrough', 'math_tilde', mathTildeRule);
  markdown.inline.ruler.before('link', 'user_reference', userReferenceRule);
  markdown.block.ruler.before('blockquote', 'spoiler', spoilerRule, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });
  markdown.renderer.rules.math_inline = (tokens, index) =>
    renderMath(tokens[index].content, false);
  markdown.renderer.rules.math_display = (tokens, index) =>
    renderMath(tokens[index].content, true);
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

const markdown = createMarkdown();

/** Statement Markdown → HTML; sanitized unless `style` is `problem-full`. */
export function renderMarkdown(text: string, style: RenderStyle): string {
  const html = wrapTables(
    shiftHeaders(markdown.render(rewriteHtmlSpoilers(text))),
  );
  return isSanitizedStyle(style) ? sanitizeStatementHtml(html) : html;
}
