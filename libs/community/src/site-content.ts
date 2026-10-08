import { NAVIGATION_REGEX_MAX } from '@libs/database';

/** The SPA tests this against the current path with `new RegExp`: refuse what does not compile or is oversized. */
export function isValidNavigationRegex(source: string): boolean {
  if (source.length > NAVIGATION_REGEX_MAX) return false;
  try {
    new RegExp(source);
    return true;
  } catch {
    return false;
  }
}

const NAVIGATION_PATH = /^(\/(?![/\\])|https?:\/\/)\S*$/;

/** A site path (one `/`, not protocol-relative; `/\` counts, browsers read `\` as `/`) or an http(s) URL, without whitespace: never `javascript:` or `data:`. */
export const isSafeNavigationPath = (path: string): boolean =>
  NAVIGATION_PATH.test(path);

/** Whether giving `id` the parent `newParentId` makes it its own ancestor; `parentOf` maps every entry to its current parent (null = root). */
export function createsCycle(
  parentOf: ReadonlyMap<string, string | null>,
  id: string,
  newParentId: string,
): boolean {
  const seen = new Set<string>();
  for (
    let current: string | null | undefined = newParentId;
    current != null && !seen.has(current);
    current = parentOf.get(current)
  ) {
    if (current === id) return true;
    seen.add(current);
  }
  return false;
}
