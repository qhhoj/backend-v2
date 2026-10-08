import sanitizeHtml from 'sanitize-html';
import { LEGACY_STYLE_PROPERTIES } from './legacy-allow-list';
import {
  LEGACY_ATTRIBUTES,
  LEGACY_TAGS,
  STATEMENT_OPTIONS,
  STYLE_VALUE,
} from './sanitizer';

/** Style properties that let author HTML escape its own box (overlays, clickjacking, invisible click targets). KaTeX is never sanitized with these rules: its output is spliced in afterwards. The sanitizer cannot confine in-flow overflow (`height:0` plus a tall child, `direction:rtl`, `float`): the post container's `overflow: clip; contain: paint; isolation: isolate` is load-bearing. */
const LAYOUT_ESCAPE_PROPERTY =
  /^(-\w+-)?(position|z-index|top|right|bottom|left|inset.*|transform.*|opacity)$/;
/** Longest style value and style attribute kept; bounds every regex below. */
const MAX_STYLE_VALUE_LENGTH = 256;
const MAX_STYLE_ATTRIBUTE_LENGTH = 1024;
/** Any viewport or container unit (a full-screen box), CSS comments (they split tokens past the other checks) and `image(`. */
const VIEWPORT_OR_COMMENT =
  /\d(?:[dsl]?v(?:w|h|i|b|min|max)|cq(?:w|h|i|b|min|max))\b|\/\*|image\s*\(/i;
/** One number with one optional unit: `\d+(\.\d+)?` and `\.\d+` cannot overlap, so matching is linear. */
const LENGTH = String.raw`(?:\d+(?:\.\d+)?|\.\d+)(?:px|em|rem|%|ch|ex|pt)?`;
/** Margins and paddings: one to four non-negative lengths or `auto`, so nothing is pulled over its neighbours. */
const SAFE_SPACING = new RegExp(
  String.raw`^(?:auto|${LENGTH})(?:\s+(?:auto|${LENGTH})){0,3}$`,
  'i',
);
/** Sizes: one non-negative length or a sizing keyword. */
const SAFE_SIZE = new RegExp(
  String.raw`^(?:${LENGTH}|auto|none|inherit|initial|fit-content|min-content|max-content)$`,
  'i',
);
const SPACING_PROPERTY = /^(-\w+-)?(margin|padding)(?!.*collapse)/;
const SIZE_PROPERTY =
  /^(-\w+-)?(min-|max-)?(logical-)?(width|height|inline-size|block-size)$/;
const withinLength = (value: string) => value.length <= MAX_STYLE_VALUE_LENGTH;
const blogValue = (check: (value: string) => boolean) =>
  ({
    test: (value: string) =>
      withinLength(value) && !VIEWPORT_OR_COMMENT.test(value) && check(value),
  }) as RegExp;
const BLOG_STYLE_VALUE = blogValue((value) => STYLE_VALUE.test(value));
const BLOG_SPACING_VALUE = blogValue((value) =>
  SAFE_SPACING.test(value.trim()),
);
const BLOG_SIZE_VALUE = blogValue((value) => SAFE_SIZE.test(value.trim()));
const valueRuleOf = (property: string): RegExp =>
  SPACING_PROPERTY.test(property)
    ? BLOG_SPACING_VALUE
    : SIZE_PROPERTY.test(property)
      ? BLOG_SIZE_VALUE
      : BLOG_STYLE_VALUE;
const BLOG_STYLES = Object.fromEntries(
  LEGACY_STYLE_PROPERTIES.filter(
    (property) => !LAYOUT_ESCAPE_PROPERTY.test(property),
  ).map((property) => [property, [valueRuleOf(property)]]),
);
/** The style attribute cut at its last whole declaration within the cap. */
const cappedStyle = (style: string): string =>
  style.length <= MAX_STYLE_ATTRIBUTE_LENGTH
    ? style
    : style.slice(0, style.lastIndexOf(';', MAX_STYLE_ATTRIBUTE_LENGTH) + 1);

/** Embeds a blog post may carry (path-checked, not just host-checked). */
const EMBED_SOURCE =
  /^https:\/\/(www\.youtube\.com\/embed|www\.youtube-nocookie\.com\/embed|player\.vimeo\.com\/video)\/[\w-]+(\?[\w=&.%-]*)?$/;
const EMBED_SANDBOX = 'allow-scripts allow-same-origin allow-presentation';

/** Every author class gets `user-` (so `user-x` becomes `user-user-x`) and cannot hit the site's stylesheet; only the exact names the Markdown pipeline emits stay. KaTeX classes never reach this pass. */
const PIPELINE_CLASSES = new Set([
  'spoiler',
  'table',
  'h-scrollable-table',
  'user-reference',
  'user-rating',
]);
const isPipelineClass = (name: string) =>
  PIPELINE_CLASSES.has(name) || name.startsWith('language-');
const prefixedClasses = (classes: string): string =>
  classes
    .split(/\s+/)
    .filter((name) => /^[\w-]+$/.test(name))
    .map((name) => (isPipelineClass(name) ? name : `user-${name}`))
    .join(' ');

/** Attribute of the placeholder element `renderMarkdown` leaves for each formula; its value carries a per-render nonce, so only the renderer can address a slot. */
export const MATH_SLOT_ATTRIBUTE = 'data-math';

/** Author HTML only: no MathML (`mpadded`/`mspace` position without CSS; KaTeX's own MathML is spliced in), no svg, no `id` (it would clobber page elements), no `aria-hidden` (KaTeX's is spliced in). Raw-text tags are dropped whole so a formula slot inside never survives as escaped text. */
const BLOG_OPTIONS: sanitizeHtml.IOptions = {
  ...STATEMENT_OPTIONS,
  allowedTags: LEGACY_TAGS,
  allowedAttributes: {
    ...LEGACY_ATTRIBUTES,
    '*': ['class', 'style', 'data', 'height'],
    span: [MATH_SLOT_ATTRIBUTE],
    iframe: [...LEGACY_ATTRIBUTES.iframe, 'sandbox', 'loading'],
  },
  nonTextTags: ['script', 'style', 'textarea', 'option', 'title', 'xmp'],
  allowedStyles: { '*': BLOG_STYLES },
  transformTags: {
    '*': (tagName, attributes) => {
      const { allow, style, ...rest } = attributes;
      return {
        tagName,
        attribs: {
          ...rest,
          ...(style === undefined ? {} : { style: cappedStyle(style) }),
          ...(attributes.class === undefined
            ? {}
            : { class: prefixedClasses(attributes.class) }),
          ...(tagName === 'iframe'
            ? {
                sandbox: EMBED_SANDBOX,
                loading: 'lazy',
                ...(allow
                  ?.split(';')
                  .some((feature) => feature.trim() === 'fullscreen')
                  ? { allow: 'fullscreen' }
                  : {}),
              }
            : {}),
          ...(tagName === 'a' && attributes.target !== undefined
            ? { rel: 'nofollow noopener noreferrer' }
            : {}),
        },
      };
    },
  },
  exclusiveFilter: (frame) =>
    frame.tag === 'iframe' && !EMBED_SOURCE.test(frame.attribs.src ?? ''),
};

/** Author HTML of a blog post: the legacy allow-list confined to the post's own box (no positioning, overlays, ids, site classes, foreign or unsandboxed iframes). Math is spliced in after this pass. */
export const sanitizeBlogHtml = (html: string): string =>
  sanitizeHtml(html, BLOG_OPTIONS);
