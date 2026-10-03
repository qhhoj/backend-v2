export interface MarkupLimits {
  maxTags: number;
  maxDepth: number;
  /** `xml`: `/>` closes any tag (SVG uploads). `html`: only inside `svg`/`math` (htmlparser2 HTML mode, used for statements). */
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
const FOREIGN_TAGS = new Set(['svg', 'math']);

/** Linear scan mirroring htmlparser2 (any `<` not followed by space, tab, LF, FF, CR, `>`, `!` or `?` opens an element). The tag cap is the hard bound; depth is best-effort (`"/>"` inside attribute values can hide nesting). */
export function isMarkupWithinLimits(
  html: string,
  { maxTags, maxDepth, mode }: MarkupLimits,
): boolean {
  let tags = 0;
  let depth = 0;
  let foreignDepth = 0;
  let cursor = html.indexOf('<');
  while (cursor !== -1) {
    const next = html[cursor + 1];
    if (next !== undefined && !/[ \t\n\f\r>!?]/.test(next)) {
      const end = html.indexOf('>', cursor);
      if (end === -1) return false;
      if (++tags > maxTags) return false;
      const closing = next === '/';
      const name =
        TAG_NAME.exec(
          html.slice(cursor + (closing ? 2 : 1), end),
        )?.[0].toLowerCase() ?? '';
      const foreign = FOREIGN_TAGS.has(name);
      if (closing) {
        depth = Math.max(0, depth - 1);
        if (foreign) foreignDepth = Math.max(0, foreignDepth - 1);
      } else if (
        !(
          html[end - 1] === '/' &&
          (mode === 'xml' || foreign || foreignDepth > 0)
        ) &&
        !VOID_TAGS.has(name)
      ) {
        if (foreign) foreignDepth++;
        if (++depth > maxDepth) return false;
      }
      cursor = end;
    }
    cursor = html.indexOf('<', cursor + 1);
  }
  return true;
}
