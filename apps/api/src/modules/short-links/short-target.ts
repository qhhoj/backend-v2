import {
  CONTEST_KEY_PATTERN,
  ORGANIZATION_SLUG_PATTERN,
  PROBLEM_CODE_PATTERN,
} from '@libs/database';

export const MAX_SHORT_PATH_LENGTH = 200;

/** A pattern's body without its anchors, to build the allow-list from the schema patterns. */
const bodyOf = (pattern: RegExp): string =>
  pattern.source.replace(/^\^|\$$/g, '');
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** The SPA's canonical routes (`frontend-v2/src/router/routes.ts`): the only places a short link may lead. No query, no fragment, no scheme, no host: whatever is stored is exactly what the redirect sends. */
const SHAPES: readonly RegExp[] = [
  new RegExp(`^/problems/${bodyOf(PROBLEM_CODE_PATTERN)}$`),
  new RegExp(
    `^/contests/${bodyOf(CONTEST_KEY_PATTERN)}(?:/(?:announcements|submissions|stats|ranking))?$`,
  ),
  new RegExp(`^/blog/${UUID}$`),
  /^\/users\/(?!\.{1,2}$)[A-Za-z0-9_.@+-]{1,150}$/,
  new RegExp(`^/organizations/${bodyOf(ORGANIZATION_SLUG_PATTERN)}$`),
];

/** The path itself when it has an allowed shape, else null. JavaScript's `$` without the `m` flag matches only at the very end, so a trailing newline does not slip through. */
export function shortTargetOf(path: unknown): string | null {
  if (typeof path !== 'string' || path.length > MAX_SHORT_PATH_LENGTH)
    return null;
  return SHAPES.some((shape) => shape.test(path)) ? path : null;
}
