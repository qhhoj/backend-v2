import sanitizeHtml from 'sanitize-html';
import {
  LEGACY_STYLE_PROPERTIES,
  MATHML_ATTRIBUTES,
  MATHML_TAGS,
} from './legacy-allow-list';

/** Legacy BLEACH_USER_SAFE_TAGS minus `style` and `object` (CSS/plugin injection; available through `problem-full`). */
export const LEGACY_TAGS = [
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
export const LEGACY_ATTRIBUTES: Record<string, string[]> = {
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
export const STYLE_VALUE =
  /^(?![\s\S]*(expression|url\s*\(|image-set\s*\(|src\s*\(|javascript|behavior|@import|\\))[^;{}\n\r]*$/i;

/** Video players an embed may come from (path-checked, not just host-checked). */
export const EMBED_SOURCE =
  /^https:\/\/(www\.youtube\.com\/embed|www\.youtube-nocookie\.com\/embed|player\.vimeo\.com\/video)\/[\w-]+(\?[\w=&.%-]*)?$/;
/** Players keep their own origin (they need it); any other page runs in an opaque origin, so even a same-site URL cannot reach the page around it. Neither may navigate the top window or open popups. */
const PLAYER_SANDBOX = 'allow-scripts allow-same-origin allow-presentation';
const PAGE_SANDBOX = 'allow-scripts allow-presentation';

/** The attributes the sanitizer forces on every iframe: a sandbox, lazy loading, and of the author's `allow` features only `fullscreen` (no camera, microphone or the like). */
export function iframeAttributes(
  attributes: sanitizeHtml.Attributes,
): sanitizeHtml.Attributes {
  const { allow, ...rest } = attributes;
  const fullscreen = allow
    ?.split(';')
    .some((feature) => feature.trim() === 'fullscreen');
  return {
    ...rest,
    sandbox: EMBED_SOURCE.test(attributes.src ?? '')
      ? PLAYER_SANDBOX
      : PAGE_SANDBOX,
    loading: 'lazy',
    ...(fullscreen ? { allow: 'fullscreen' } : {}),
  };
}

export const STATEMENT_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [...LEGACY_TAGS, ...MATHML_TAGS, ...KATEX_TAGS],
  allowedAttributes: {
    ...LEGACY_ATTRIBUTES,
    ...MATHML_ATTRIBUTES,
    ...KATEX_ATTRIBUTES,
    '*': [...LEGACY_ATTRIBUTES['*'], 'aria-hidden'],
    span: [...MATHML_ATTRIBUTES.span, 'title'],
    iframe: [...LEGACY_ATTRIBUTES.iframe, 'sandbox', 'loading'],
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
  transformTags: {
    iframe: (tagName, attributes) => ({
      tagName,
      attribs: iframeAttributes(attributes),
    }),
  },
};

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
