import { posix } from 'node:path';
import { SAFE_SEGMENT } from '@libs/common';
import { childrenOf, descendant, INIT_FILE } from '@libs/problems';
import type { XmlElement } from '@libs/problems';
import {
  CHECKER_FILE,
  INTERACTOR_FILE,
  resolveMemberPath,
  TESTS_ARCHIVE,
} from './polygon-package';
import type { PolygonPackage } from './polygon-package';

const HEADER_NAME = /\.(h|hpp|hh)$/i;
const HEADER_TYPE = /^h\./;
/** Data files the import writes itself; a header never takes their name. */
const RESERVED_NAMES: ReadonlySet<string> = new Set([
  TESTS_ARCHIVE,
  CHECKER_FILE,
  INTERACTOR_FILE,
  INIT_FILE,
]);

/** A header staged beside the interactor: `path` in the package, `name` in the data directory. */
export interface HelperHeader {
  path: string;
  name: string;
}

/** `<resources>` a program can `#include`: the `h.*` types, and anything named like a header. */
export function headerPathsOf(
  root: XmlElement,
  pkg: Pick<PolygonPackage, 'has'>,
): string[] {
  const resources = descendant(root, 'resources');
  return childrenOf(resources ?? root, 'file').flatMap(({ attributes }) => {
    const { path, type } = attributes;
    const isHeader =
      path && (HEADER_TYPE.test(type ?? '') || HEADER_NAME.test(path));
    return isHeader && pkg.has(path) ? [resolveMemberPath(path)] : [];
  });
}

const isDataFileName = (name: string): boolean =>
  SAFE_SEGMENT.test(name) && !name.includes('..') && !RESERVED_NAMES.has(name);

/** The package's headers under their base names (the first of a repeated name wins), as the flat data directory holds them; a name it cannot hold, or one of `taken` (the problem's own checker, interactor and other non-header files), is left out. */
export function helperHeadersOf(
  root: XmlElement,
  pkg: Pick<PolygonPackage, 'has'>,
  taken: ReadonlySet<string> = new Set(),
): HelperHeader[] {
  const byName = new Map<string, string>();
  for (const path of headerPathsOf(root, pkg)) {
    const name = posix.basename(path);
    if (isDataFileName(name) && !taken.has(name) && !byName.has(name))
      byName.set(name, path);
  }
  return [...byName].map(([name, path]) => ({ path, name }));
}
