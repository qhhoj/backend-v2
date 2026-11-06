import { posix } from 'node:path';
import type { Readable } from 'node:stream';
import { ARCHIVE_MAX_BYTES } from '@libs/problems';
import type { GenerationPlan } from '@libs/judging';
import type { XmlElement } from '@libs/problems';
import { MIB } from '@libs/common';
import { headerPathsOf } from './polygon-headers';
import { PolygonImportError } from './polygon-import.error';
import { repackMembers, shown } from './polygon-package';
import type { PolygonPackage, RepackMember } from './polygon-package';

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
  if (bytes > ARCHIVE_MAX_BYTES)
    throw new PolygonImportError(
      `the sources and manual tests of the package are larger than ${ARCHIVE_MAX_BYTES / MIB} MiB`,
    );
  return repackMembers(
    pkg,
    members,
    (path) => `${shown(path)} is missing from the package`,
  );
}
