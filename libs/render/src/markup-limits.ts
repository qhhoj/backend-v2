export interface MarkupLimits {
  maxTags: number;
  maxDepth: number;
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

/** Linear scan mirroring htmlparser2 (any `<` not followed by space, tab, LF, FF, CR, `>`, `!` or `?` opens an element). The tag cap is the hard bound; depth is best-effort (`"/>"` inside attribute values can hide nesting). */
export function isMarkupWithinLimits(
  html: string,
  { maxTags, maxDepth }: MarkupLimits,
): boolean {
  let tags = 0;
  let depth = 0;
  let cursor = html.indexOf('<');
  while (cursor !== -1) {
    const next = html[cursor + 1];
    if (next !== undefined && !/[ \t\n\f\r>!?]/.test(next)) {
      const end = html.indexOf('>', cursor);
      if (end === -1) return false;
      if (++tags > maxTags) return false;
      if (next === '/') depth = Math.max(0, depth - 1);
      else if (
        html[end - 1] !== '/' &&
        !VOID_TAGS.has(
          TAG_NAME.exec(html.slice(cursor + 1, end))?.[0].toLowerCase() ?? '',
        ) &&
        ++depth > maxDepth
      )
        return false;
      cursor = end;
    }
    cursor = html.indexOf('<', cursor + 1);
  }
  return true;
}
