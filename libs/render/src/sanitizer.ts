import sanitizeHtml from 'sanitize-html';
import {
  LEGACY_STYLE_PROPERTIES,
  MATHML_ATTRIBUTES,
  MATHML_TAGS,
} from './legacy-allow-list';

/** Legacy BLEACH_USER_SAFE_TAGS minus `style` and `object` (CSS/plugin injection; available through `problem-full`). */
const LEGACY_TAGS = [
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'b',
  'i',
  'strong',
  'em',
  'tt',
  'del',
  'kbd',
  's',
  'abbr',
  'cite',
  'mark',
  'q',
  'samp',
  'small',
  'u',
  'var',
  'wbr',
  'dfn',
  'ruby',
  'rb',
  'rp',
  'rt',
  'rtc',
  'sub',
  'sup',
  'time',
  'data',
  'p',
  'br',
  'pre',
  'span',
  'div',
  'blockquote',
  'code',
  'hr',
  'ul',
  'ol',
  'li',
  'dd',
  'dl',
  'dt',
  'address',
  'section',
  'details',
  'summary',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'caption',
  'colgroup',
  'col',
  'img',
  'audio',
  'video',
  'source',
  'a',
  'strike',
  'noscript',
  'center',
  'iframe',
];
/** Legacy BLEACH_USER_SAFE_ATTRS; `a` also keeps the `rel`/`target` the Markdown pipeline adds. */
const LEGACY_ATTRIBUTES: Record<string, string[]> = {
  '*': ['id', 'class', 'style', 'data', 'height'],
  img: ['src', 'alt', 'title', 'width', 'height', 'data-src', 'align'],
  a: ['href', 'alt', 'title', 'rel', 'target'],
  iframe: ['src', 'height', 'width', 'allow'],
  abbr: ['title'],
  dfn: ['title'],
  time: ['datetime'],
  data: ['value'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan'],
  audio: [
    'autoplay',
    'controls',
    'crossorigin',
    'muted',
    'loop',
    'preload',
    'src',
  ],
  video: [
    'autoplay',
    'controls',
    'crossorigin',
    'height',
    'muted',
    'loop',
    'poster',
    'preload',
    'src',
    'width',
  ],
  source: ['src', 'srcset', 'type'],
  li: ['value'],
};
/** What KaTeX emits beyond the legacy list: `aria-hidden` on its spans and `<svg><path>` for stretchy delimiters. */
const KATEX_TAGS = ['svg', 'path'];
const KATEX_ATTRIBUTES: Record<string, string[]> = {
  svg: ['xmlns', 'width', 'height', 'viewBox', 'preserveAspectRatio'],
  path: ['d'],
};
/** A style value must not smuggle script or an external fetch. */
const STYLE_VALUE =
  /^(?![\s\S]*(expression|url\s*\(|image-set\s*\(|src\s*\(|javascript|behavior|@import|\\))[^;{}\n\r]*$/i;

const STATEMENT_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [...LEGACY_TAGS, ...MATHML_TAGS, ...KATEX_TAGS],
  allowedAttributes: {
    ...LEGACY_ATTRIBUTES,
    ...MATHML_ATTRIBUTES,
    ...KATEX_ATTRIBUTES,
    '*': [...LEGACY_ATTRIBUTES['*'], 'aria-hidden'],
    span: [...MATHML_ATTRIBUTES.span, 'title'],
  },
  allowedStyles: {
    '*': Object.fromEntries(
      LEGACY_STYLE_PROPERTIES.map((property) => [property, [STYLE_VALUE]]),
    ),
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesAppliedToAttributes: [
    'href',
    'src',
    'cite',
    'data',
    'poster',
    'srcset',
    'altimg',
    'data-src',
  ],
  parser: { lowerCaseAttributeNames: false },
};

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

/** Author HTML only: no MathML (`mpadded`/`mspace` position without CSS; KaTeX's own MathML is spliced in), no svg, no `id` (it would clobber page elements). */
const BLOG_OPTIONS: sanitizeHtml.IOptions = {
  ...STATEMENT_OPTIONS,
  allowedTags: LEGACY_TAGS,
  allowedAttributes: {
    ...LEGACY_ATTRIBUTES,
    '*': ['class', 'style', 'data', 'height', 'aria-hidden'],
    span: ['title', MATH_SLOT_ATTRIBUTE],
    iframe: [...LEGACY_ATTRIBUTES.iframe, 'sandbox', 'loading'],
  },
  nonTextTags: ['script', 'style', 'textarea', 'option', 'title'],
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

/** Statement/editorial HTML for the sanitized styles: the legacy bleach allow-list plus KaTeX output. */
export const sanitizeStatementHtml = (html: string): string =>
  sanitizeHtml(html, STATEMENT_OPTIONS);

const SVG_TAGS = [
  'svg',
  'g',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'defs',
  'use',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
  'mask',
  'pattern',
  'symbol',
  'title',
  'desc',
];
const SVG_ATTRIBUTES = [
  'id',
  'class',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'width',
  'height',
  'd',
  'points',
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'opacity',
  'fill-opacity',
  'stroke-opacity',
  'transform',
  'font-size',
  'font-family',
  'font-weight',
  'text-anchor',
  'dominant-baseline',
  'offset',
  'stop-color',
  'stop-opacity',
  'gradientUnits',
  'gradientTransform',
  'viewBox',
  'preserveAspectRatio',
  'xmlns',
  'xmlns:xlink',
  'clip-path',
  'mask',
  'href',
  'xlink:href',
  'version',
];
const PAINT_ATTRIBUTES = ['fill', 'stroke', 'clip-path', 'mask'];
const UNSAFE_PAINT_VALUE = /url\s*\(\s*['"]?\s*[^#'"\s]|\\/i;
/** Paint and reference attributes may use colors, keywords and `url(#local)` only. */
const dropExternalPaint: sanitizeHtml.Transformer = (tagName, attributes) => ({
  tagName,
  attribs: Object.fromEntries(
    Object.entries(attributes).filter(
      ([name, value]) =>
        !PAINT_ATTRIBUTES.includes(name) || !UNSAFE_PAINT_VALUE.test(value),
    ),
  ),
});
const SVG_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: SVG_TAGS,
  allowedAttributes: { '*': SVG_ATTRIBUTES },
  allowedSchemes: [],
  allowProtocolRelative: false,
  transformTags: { '*': dropExternalPaint },
  allowedSchemesAppliedToAttributes: ['href', 'xlink:href'],
  parser: {
    lowerCaseTags: false,
    lowerCaseAttributeNames: false,
    xmlMode: true,
  },
};

/** Uploaded SVG images: shapes, gradients and `#local` references only; scripts, handlers, styles, foreign content and external hrefs are dropped. */
export const sanitizeSvg = (svg: string): string =>
  sanitizeHtml(svg, SVG_OPTIONS);
