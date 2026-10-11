import { posix } from 'node:path';
import type { Readable } from 'node:stream';
import {
  childrenOf,
  descendant,
  POLYGON_PACKAGE_MAX_BYTES,
} from '@libs/problems';
import type { GenerationPlan } from '@libs/judging';
import type { XmlElement } from '@libs/problems';
import { PolygonImportError } from './polygon-import.error';
import { repackMembers, resolveMemberPath, shown } from './polygon-package';
import type { PolygonPackage, RepackMember } from './polygon-package';

const HEADER_NAME = /\.(h|hpp|hh)$/i;
const HEADER_TYPE = /^h\./;
const BYTES_PER_MIB = 1024 * 1024;

/** `<resources>` a program can `#include`: the `h.*` types, and anything named like a header. */
function headerPathsOf(root: XmlElement, pkg: PolygonPackage): string[] {
  const resources = descendant(root, 'resources');
  return childrenOf(resources ?? root, 'file').flatMap(({ attributes }) => {
    const { path, type } = attributes;
    const isHeader =
      path && (HEADER_TYPE.test(type ?? '') || HEADER_NAME.test(path));
    return isHeader && pkg.has(path) ? [resolveMemberPath(path)] : [];
  });
}

/**
 * Where every file goes in the bundle: the program sources and manual inputs at their package paths, and each header
 * copied into the directory of every program source, so `#include "testlib.h"` finds the package's own beside it.
 */
function bundleMembersOf(
  pkg: PolygonPackage,
  root: XmlElement,
  plan: GenerationPlan,
): RepackMember[] {
  const members = new Map<string, string>();
  const add = (from: string, to = from) => members.set(to, from);
  const directories = new Set(
    plan.programs.map(({ sourcePath }) => posix.dirname(sourcePath)),
  );
  for (const { sourcePath } of plan.programs) add(sourcePath);
  for (const { manualPath } of plan.tests) if (manualPath) add(manualPath);
  for (const header of headerPathsOf(root, pkg))
    for (const directory of directories)
      if (!members.has(posix.join(directory, posix.basename(header))))
        add(header, posix.join(directory, posix.basename(header)));
  return [...members].map(([to, from]) => ({ from, to }));
}

/** The zip a judge compiles and runs from; it must fit the package limit (it is read back whole on the judge). */
export function generationBundle(
  pkg: PolygonPackage,
  root: XmlElement,
  plan: GenerationPlan,
): Readable {
  const members = bundleMembersOf(pkg, root, plan);
  const bytes = members.reduce((sum, { from }) => sum + pkg.sizeOf(from), 0);
  if (bytes > POLYGON_PACKAGE_MAX_BYTES)
    throw new PolygonImportError(
      `the sources and manual tests of the package are larger than ${POLYGON_PACKAGE_MAX_BYTES / BYTES_PER_MIB} MiB`,
    );
  return repackMembers(
    pkg,
    members,
    (path) => `${shown(path)} is missing from the package`,
  );
}
