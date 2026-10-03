import { Parser } from 'htmlparser2';

export interface MarkupLimits {
  maxTags: number;
  maxDepth: number;
  /** `xml`: linear scan where `/>` closes any tag (SVG uploads). `html`: parsed by htmlparser2 itself, the copy sanitize-html uses (statements). */
  mode: 'html' | 'xml';
}

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);
const TAG_NAME = /^[^ \t\n\f\r/>]+/;
class LimitExceeded extends Error {}

/** Same parser and options as the statement sanitizer, so the guard sees exactly the tree the sanitizer will walk. Counts opening tags only. */
function isHtmlWithinLimits(
  html: string,
  { maxTags, maxDepth }: MarkupLimits,
): boolean {
  let tags = 0;
  let depth = 0;
  const parser = new Parser(
    {
      onopentag: () => {
        if (++tags > maxTags || ++depth > maxDepth) throw new LimitExceeded();
      },
      onclosetag: () => {
        depth--;
      },
    },
    { lowerCaseAttributeNames: false },
  );
  try {
    parser.write(html);
    parser.end();
    return true;
  } catch (error) {
    if (error instanceof LimitExceeded) return false;
    throw error;
  }
}

/** Linear scan mirroring htmlparser2 in XML mode (any `<` not followed by space, tab, LF, FF, CR, `>`, `!` or `?` opens an element). The tag cap is the hard bound; depth is best-effort (`"/>"` inside attribute values can hide nesting). */
function isXmlWithinLimits(
  xml: string,
  { maxTags, maxDepth }: MarkupLimits,
): boolean {
  let tags = 0;
  let depth = 0;
  let cursor = xml.indexOf('<');
  while (cursor !== -1) {
    const next = xml[cursor + 1];
    if (next !== undefined && !/[ \t\n\f\r>!?]/.test(next)) {
      const end = xml.indexOf('>', cursor);
      if (end === -1) return false;
      if (++tags > maxTags) return false;
      if (next === '/') depth = Math.max(0, depth - 1);
      else if (
        xml[end - 1] !== '/' &&
        !VOID_TAGS.has(
          TAG_NAME.exec(xml.slice(cursor + 1, end))?.[0].toLowerCase() ?? '',
        ) &&
        ++depth > maxDepth
      )
        return false;
      cursor = end;
    }
    cursor = xml.indexOf('<', cursor + 1);
  }
  return true;
}

export const isMarkupWithinLimits = (
  markup: string,
  limits: MarkupLimits,
): boolean =>
  limits.mode === 'html'
    ? isHtmlWithinLimits(markup, limits)
    : isXmlWithinLimits(markup, limits);
