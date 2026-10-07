import sanitizeHtml from 'sanitize-html';
import { KATEX_CLASSES, KATEX_UNSTYLED_CLASSES } from './katex-classes';
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

/** Style properties that let a post escape its own box (overlays, clickjacking). `top`/`left` stay only as KaTeX's small em offsets, `position` only in flow. */
const LAYOUT_ESCAPE_PROPERTY =
  /^(-\w+-)?(z-index|right|bottom|inset.*|transform.*)$/;
/** `position` stays only as `relative` (KaTeX positions large operators with it); it cannot leave the post's box. */
const IN_FLOW_POSITION = /^(relative|static)$/;
const KATEX_OFFSET = /^-?\d{1,3}(\.\d+)?em$/;
const RESTRICTED_VALUES: Record<string, RegExp> = {
  position: IN_FLOW_POSITION,
  top: KATEX_OFFSET,
  left: KATEX_OFFSET,
};
const BLOG_STYLES = Object.fromEntries(
  LEGACY_STYLE_PROPERTIES.filter(
    (property) => !LAYOUT_ESCAPE_PROPERTY.test(property),
  ).map((property) => [property, [RESTRICTED_VALUES[property] ?? STYLE_VALUE]]),
);

/** Embeds a blog post may carry (path-checked, not just host-checked). */
const EMBED_SOURCE =
  /^https:\/\/(www\.youtube\.com\/embed|www\.youtube-nocookie\.com\/embed|player\.vimeo\.com\/video)\/[\w-]+(\?[\w=&.%-]*)?$/;
const EMBED_SANDBOX = 'allow-scripts allow-same-origin allow-presentation';

/** Classes the Markdown pipeline and KaTeX emit (KaTeX's from its stylesheet); any other class is the author's and gets `user-`, so it cannot hit the site's stylesheet. Names already in the `user-` namespace (`user-reference`) stay. */
const PIPELINE_CLASSES = new Set([
  ...KATEX_CLASSES,
  ...KATEX_UNSTYLED_CLASSES,
  'math-error',
  'spoiler',
  'table',
  'h-scrollable-table',
]);
const isPipelineClass = (name: string) =>
  PIPELINE_CLASSES.has(name) ||
  name.startsWith('user-') ||
  name.startsWith('language-');
const prefixedClasses = (classes: string): string =>
  classes
    .split(/\s+/)
    .filter((name) => /^[\w-]+$/.test(name))
    .map((name) => (isPipelineClass(name) ? name : `user-${name}`))
    .join(' ');

/** Legacy `id`s would clobber page elements (`id="navbar"`, `__proto__`); the blog drops them everywhere. */
const withoutId = (attributes: readonly string[]) =>
  attributes.filter((name) => name !== 'id');
const BLOG_ALLOWED_ATTRIBUTES = Object.fromEntries(
  Object.entries(
    STATEMENT_OPTIONS.allowedAttributes as Record<string, string[]>,
  ).map(([tag, attributes]) => [tag, withoutId(attributes)]),
);

const BLOG_OPTIONS: sanitizeHtml.IOptions = {
  ...STATEMENT_OPTIONS,
  allowedAttributes: {
    ...BLOG_ALLOWED_ATTRIBUTES,
    iframe: [...BLOG_ALLOWED_ATTRIBUTES.iframe, 'sandbox', 'loading'],
  },
  allowedStyles: { '*': BLOG_STYLES },
  transformTags: {
    '*': (tagName, attributes) => ({
      tagName,
      attribs: {
        ...attributes,
        ...(attributes.class === undefined
          ? {}
          : { class: prefixedClasses(attributes.class) }),
        ...(tagName === 'iframe'
          ? { sandbox: EMBED_SANDBOX, loading: 'lazy' }
          : {}),
      },
    }),
  },
  exclusiveFilter: (frame) =>
    frame.tag === 'iframe' && !EMBED_SOURCE.test(frame.attribs.src ?? ''),
};

/** Blog post HTML: the statement allow-list confined to the post's own box (no positioning, id, site classes, foreign or unsandboxed iframes). */
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
